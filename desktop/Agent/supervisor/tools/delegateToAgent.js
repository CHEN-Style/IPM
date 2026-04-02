import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { interrupt } from '@langchain/langgraph';
import { getOrCreateSession } from '../../project-agent/session.js';

export function createDelegateToAgentTool(deps) {
  const { getWorkspaceDirOrThrow, syncStructureJson, getAutonomousMode } = deps;

  return tool(
    async ({ projectName, domain, task }) => {
      let projectDir;
      try {
        const resolved = getWorkspaceDirOrThrow(projectName, domain);
        projectDir = resolved.projectDir;
        projectName = resolved.name;
        domain = resolved.domain;
      } catch (e) {
        return `无法找到项目: ${e.message}`;
      }

      const session = getOrCreateSession(projectDir, projectName, domain);

      const events = [];
      let interruptPlan = null;

      try {
        for await (const event of session.sendMessage(task)) {
          if (event.type === 'interrupt') {
            interruptPlan = event.plan;
            break;
          }
          if (event.type === 'done') {
            break;
          }
          if (event.type === 'token' || event.type === 'tool-start' || event.type === 'tool-end') {
            events.push(event);
          }
        }
      } catch (e) {
        return `委托执行出错: ${e.message}`;
      }

      if (interruptPlan) {
        const autonomous = typeof getAutonomousMode === 'function' ? getAutonomousMode() : false;

        if (autonomous) {
          try {
            const approvalEvents = [];
            for await (const event of session.resumeAfterApproval({ approved: true, selectedIds: [] })) {
              approvalEvents.push(event);
            }

            if (typeof syncStructureJson === 'function') {
              try { syncStructureJson(projectDir, projectName); } catch { /* best effort */ }
            }

            const textParts = approvalEvents
              .filter((e) => e.type === 'token')
              .map((e) => e.content);
            const toolResults = approvalEvents
              .filter((e) => e.type === 'tool-end')
              .map((e) => `[${e.name}] ${e.result}`);

            return `[自治模式] 专员已自动执行:\n${toolResults.join('\n')}\n\n${textParts.join('')}`;
          } catch (e) {
            return `[自治模式] 自动执行失败: ${e.message}`;
          }
        } else {
          const userDecision = interrupt({
            requiresConfirmation: true,
            delegatedFrom: 'supervisor',
            projectName,
            domain,
            ...interruptPlan,
          });

          if (userDecision?.cancelled) {
            try {
              const cancelEvents = [];
              for await (const event of session.resumeAfterApproval({ cancelled: true })) {
                cancelEvents.push(event);
              }
            } catch { /* ignore */ }
            return '用户已取消该操作计划。';
          }

          try {
            const approvalEvents = [];
            for await (const event of session.resumeAfterApproval({
              approved: true,
              selectedIds: userDecision?.selectedIds || [],
            })) {
              approvalEvents.push(event);
            }

            if (typeof syncStructureJson === 'function') {
              try { syncStructureJson(projectDir, projectName); } catch { /* best effort */ }
            }

            const textParts = approvalEvents
              .filter((e) => e.type === 'token')
              .map((e) => e.content);
            const toolResults = approvalEvents
              .filter((e) => e.type === 'tool-end')
              .map((e) => `[${e.name}] ${e.result}`);

            const parts = [];
            if (toolResults.length) parts.push(`执行结果:\n${toolResults.join('\n')}`);
            if (textParts.join('').trim()) parts.push(`专员回复: ${textParts.join('')}`);
            return parts.join('\n\n') || '专员已完成操作。';
          } catch (e) {
            return `用户确认后执行失败: ${e.message}`;
          }
        }
      }

      const textParts = events.filter((e) => e.type === 'token').map((e) => e.content);
      const toolResults = events.filter((e) => e.type === 'tool-end').map((e) => `[${e.name}] ${e.result}`);

      if (typeof syncStructureJson === 'function') {
        try { syncStructureJson(projectDir, projectName); } catch { /* best effort */ }
      }

      const resultParts = [];
      if (toolResults.length) resultParts.push(`工具执行结果:\n${toolResults.join('\n')}`);
      if (textParts.join('').trim()) resultParts.push(`专员回复: ${textParts.join('')}`);

      return resultParts.join('\n\n') || '专员已完成任务（无额外输出）。';
    },
    {
      name: 'delegate_to_agent',
      description: 'Delegate a specific file management task to the project-level agent for a given project/case. The agent will execute the task and return results. Write operations may require user confirmation (safe mode) or auto-approve (autonomous mode).',
      schema: z.object({
        projectName: z.string().min(1).describe('Name of the project or case to delegate to'),
        domain: z.enum(['projects', 'cases', 'study']).describe('Workspace domain: projects, cases, or study'),
        task: z.string().min(1).describe('Clear description of the task for the project agent to execute'),
      }),
    },
  );
}
