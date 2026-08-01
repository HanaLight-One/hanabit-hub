import path from "node:path";
import { createPendingNewsStore } from "./news-item-store.mjs";

const ID_PATTERN = /^[a-f0-9]{32}$/u;
const REVIEWABLE_DECISIONS = new Set(["review", "publish"]);

function approvalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createNewsApprovalService({ root, now = () => new Date() }) {
  if (!path.isAbsolute(root)) {
    throw new TypeError("뉴스 상태 루트는 절대경로여야 합니다.");
  }

  const store = createPendingNewsStore({ root });

  async function approveForDc(id) {
    if (!ID_PATTERN.test(String(id ?? ""))) {
      throw approvalError("INVALID_ID", "올바르지 않은 뉴스 ID입니다.");
    }

    try {
      let changed = false;
      const record = await store.update(id, (current) => {
        const workflow = current.workflow ?? {};
        if (workflow.dcPublication) {
          throw approvalError("ALREADY_PUBLISHED", "이미 게시 영수증이 있는 뉴스입니다.");
        }
        if (workflow.dcApproval?.status === "approved") return current;
        if (
          workflow.status !== "pending_review" ||
          !REVIEWABLE_DECISIONS.has(workflow.triage?.decision)
        ) {
          throw approvalError("NOT_REVIEWABLE", "번역과 판정이 끝난 검토 후보만 승인할 수 있습니다.");
        }

        changed = true;
        return {
          ...current,
          workflow: {
            ...workflow,
            status: "approved_for_dc",
            dcApproval: {
              schemaVersion: 1,
              status: "approved",
              approvedAt: now().toISOString(),
              target: "dcinside",
            },
          },
        };
      });

      return {
        id: record.id,
        changed,
        approval: {
          status: record.workflow.dcApproval.status,
          approvedAt: record.workflow.dcApproval.approvedAt,
        },
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        throw approvalError("NOT_FOUND", "뉴스 항목을 찾을 수 없습니다.");
      }
      throw error;
    }
  }

  return Object.freeze({ approveForDc });
}
