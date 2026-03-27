import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { createChatModel } from '../services/llm.js';
import { buildProjectAgentPrompt } from './prompts.js';

import { createBrowseStructureTool } from '../tools/browseStructure.js';
import { createInspectFolderTool } from '../tools/inspectFolder.js';
import { createQueryHistoryTool } from '../tools/queryHistory.js';
import { createGetSourceInfoTool } from '../tools/getSourceInfo.js';
import { createGetUserRulesTool } from '../tools/getUserRules.js';
import { createGetPreferencesTool } from '../tools/getPreferences.js';

import { createGetProjectStatsTool } from '../tools/getProjectStats.js';
import { createGetRecentEventsTool } from '../tools/getRecentEvents.js';
import { createSearchFilesTool } from '../tools/searchFiles.js';
import { createReadOwnMemoryTool } from '../tools/readOwnMemory.js';

import { createMoveFilesTool } from '../tools/moveFiles.js';
import { createRenameFileTool } from '../tools/renameFile.js';
import { createCreateFolderTool } from '../tools/createFolder.js';
import { createUpdateFolderDescriptionTool } from '../tools/updateFolderDescription.js';

import { createClassifyFileTool } from '../tools/classifyFileDelegate.js';
import { createClassifyBatchTool } from '../tools/classifyBatchDelegate.js';
import { createUndoLastActionTool } from '../tools/undoLastAction.js';

import { createAddClassifyRuleTool } from '../tools/addClassifyRule.js';
import { createAddPreferenceTool } from '../tools/addPreference.js';
import { createListClassifyEventsTool } from '../tools/listClassifyEvents.js';
import { createAddEventFeedbackTool } from '../tools/addEventFeedback.js';

const MAX_RECURSION = 30;

export function createProjectAgent(projectDir, projectName, domain, deps = {}) {
  const ctx = deps.toolContext || {};

  const tools = [
    createBrowseStructureTool(projectDir),
    createInspectFolderTool(projectDir),
    createQueryHistoryTool(projectDir, projectName),
    createGetSourceInfoTool(projectDir),
    createGetUserRulesTool(projectDir),
    createGetPreferencesTool(projectDir),

    createGetProjectStatsTool(projectDir),
    createGetRecentEventsTool(projectDir),
    createSearchFilesTool(projectDir),
    createReadOwnMemoryTool(projectDir),

    createMoveFilesTool(projectDir, ctx),
    createRenameFileTool(projectDir, ctx),
    createCreateFolderTool(projectDir, ctx),
    createUpdateFolderDescriptionTool(projectDir, ctx),

    createClassifyFileTool(projectDir, projectName),
    createClassifyBatchTool(projectDir, projectName),

    createUndoLastActionTool(projectDir),

    createAddClassifyRuleTool(projectDir),
    createAddPreferenceTool(projectDir),
    createListClassifyEventsTool(projectDir),
    createAddEventFeedbackTool(projectDir),
  ];

  const model = createChatModel();
  const prompt = buildProjectAgentPrompt(projectName, domain);
  const checkpointer = new MemorySaver();

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
    checkpointer,
  });

  return { agent, checkpointer, recursionLimit: MAX_RECURSION };
}
