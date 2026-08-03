from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import openai
from openai import OpenAI


DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
SMOKE_PROMPT = "Reply with READY only."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def metadata_path_for(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.name}.metadata.json")


def load_prompt(args: argparse.Namespace) -> str:
    if args.smoke_test:
        return SMOKE_PROMPT
    if args.prompt_file:
        prompt = args.prompt_file.read_text(encoding="utf-8-sig")
    else:
        prompt = sys.stdin.read()
    if not prompt.strip():
        raise ValueError("프롬프트가 비어 있습니다.")
    return prompt


def load_json_schema(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict) or value.get("type") != "object":
        raise ValueError("JSON Schema의 루트는 object여야 합니다.")
    return value


def usage_value(usage: Any, name: str) -> int | None:
    value = getattr(usage, name, None) if usage is not None else None
    return int(value) if value is not None else None


def provider_error_reason(error: Exception) -> str:
    if isinstance(error, openai.RateLimitError):
        return "rate_limit"
    if isinstance(error, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return "authentication"
    if isinstance(error, openai.APIConnectionError):
        return "connection"
    if isinstance(error, openai.APITimeoutError):
        return "timeout"
    if isinstance(error, (openai.BadRequestError, openai.UnprocessableEntityError)):
        return "bad_request"
    if isinstance(error, openai.InternalServerError):
        return "provider_server"

    status_code = getattr(error, "status_code", None)
    if status_code == 429:
        return "rate_limit"
    if status_code in {401, 403}:
        return "authentication"
    if status_code in {400, 404, 409, 422}:
        return "bad_request"
    if isinstance(status_code, int) and status_code >= 500:
        return "provider_server"
    return "unknown"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tool-free OpenAI Responses API text runner")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--prompt-file", type=Path)
    source.add_argument("--stdin", action="store_true")
    source.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model")
    parser.add_argument("--json-schema-file", type=Path)
    parser.add_argument("--max-output-tokens", type=int, default=512)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("HANABIT_PROVIDER_REASON=authentication", file=sys.stderr)
        print("OPENAI_API_KEY가 없습니다.", file=sys.stderr)
        return 2

    model = args.model or os.environ.get("OPENAI_TEXT_MODEL") or DEFAULT_MODEL
    max_output_tokens = 64 if args.smoke_test else args.max_output_tokens
    if max_output_tokens < 1:
        print("--max-output-tokens는 1 이상이어야 합니다.", file=sys.stderr)
        return 2

    output_path = args.output.resolve()
    metadata_path = metadata_path_for(output_path)
    prompt = load_prompt(args)
    json_schema = load_json_schema(args.json_schema_file)
    metadata: dict[str, Any] = {
        "timestamp": utc_now(),
        "model": model,
        "success": False,
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }

    client = OpenAI(
        api_key=api_key,
        max_retries=0,
        timeout=httpx.Timeout(timeout=90.0, connect=10.0, read=60.0, write=30.0, pool=10.0),
    )
    max_attempts = 1 if args.smoke_test else 2
    response = None

    try:
        for attempt in range(1, max_attempts + 1):
            try:
                request: dict[str, Any] = {
                    "model": model,
                    "input": prompt,
                    "max_output_tokens": max_output_tokens,
                }
                if json_schema is not None:
                    request["text"] = {
                        "format": {
                            "type": "json_schema",
                            "name": "hanabit_text_response",
                            "schema": json_schema,
                            "strict": True,
                        }
                    }
                response = client.responses.create(**request)
                break
            except (openai.APIConnectionError, openai.APITimeoutError):
                if attempt >= max_attempts:
                    raise
                time.sleep(2.0)

        if response is None:
            raise RuntimeError("응답 객체를 받지 못했습니다.")
        result_text = response.output_text
        usage = response.usage
        metadata.update(
            {
                "timestamp": utc_now(),
                "model": getattr(response, "model", model),
                "success": True,
                "input_tokens": usage_value(usage, "input_tokens"),
                "output_tokens": usage_value(usage, "output_tokens"),
                "total_tokens": usage_value(usage, "total_tokens"),
            }
        )
        request_id = getattr(response, "_request_id", None)
        if request_id:
            metadata["request_id"] = request_id

        atomic_write_text(output_path, result_text)
        atomic_write_json(metadata_path, metadata)
        print(
            json.dumps(
                {
                    "success": True,
                    "model": metadata["model"],
                    "input_tokens": metadata["input_tokens"],
                    "output_tokens": metadata["output_tokens"],
                    "total_tokens": metadata["total_tokens"],
                    "output": str(output_path),
                    "metadata": str(metadata_path),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as error:
        request_id = getattr(error, "request_id", None)
        if request_id:
            metadata["request_id"] = request_id
        atomic_write_json(metadata_path, metadata)
        print(f"HANABIT_PROVIDER_REASON={provider_error_reason(error)}", file=sys.stderr)
        print(
            f"OpenAI 요청 실패 ({type(error).__name__}). "
            "모델 접근 권한, 프로젝트 공유 설정, 잔액과 네트워크를 확인하세요.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
