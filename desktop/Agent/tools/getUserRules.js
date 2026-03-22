import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createGetUserRulesTool() {
  return tool(
    async () => {
      // Phase 1: return empty — user-defined rules UI not yet implemented.
      // Phase 2 will read rules from state.json or a dedicated rules store.
      return JSON.stringify([], null, 2);
    },
    {
      name: 'get_user_rules',
      description:
        'Get user-defined classification rules (e.g. "files containing 合同 should go to 收到资料"). Currently returns an empty list; will be populated when the rules UI is implemented.',
      schema: z.object({}),
    },
  );
}
