export const NodeType = {
  FOLDER: 'FOLDER',
  FILE: 'FILE',
};

export const MOCK_FILE_TREE = [
  {
    id: 'root-1',
    name: 'Research Projects',
    type: NodeType.FOLDER,
    children: [
      {
        id: 'proj-alpha',
        name: 'Project Alpha',
        type: NodeType.FOLDER,
        children: [
          { id: 'doc-1', name: 'Specifications.pdf', type: NodeType.FILE },
          { id: 'doc-2', name: 'Market Analysis.docx', type: NodeType.FILE },
        ],
      },
      {
        id: 'proj-beta',
        name: 'Project Beta',
        type: NodeType.FOLDER,
        children: [{ id: 'doc-3', name: 'Competitor Review.xlsx', type: NodeType.FILE }],
      },
    ],
  },
  {
    id: 'root-2',
    name: 'Personal Archive',
    type: NodeType.FOLDER,
    children: [
      {
        id: 'folder-finance',
        name: 'Finance',
        type: NodeType.FOLDER,
        children: [],
      },
      {
        id: 'folder-ideas',
        name: 'Random Ideas',
        type: NodeType.FOLDER,
        children: [{ id: 'doc-4', name: 'Startup Ideas.txt', type: NodeType.FILE }],
      },
    ],
  },
  {
    id: 'root-locked',
    name: 'System Files (Restricted)',
    type: NodeType.FOLDER,
    restricted: true,
    children: [{ id: 'sys-1', name: 'Config.json', type: NodeType.FILE, restricted: true }],
  },
];

export const MOCK_SNIPPETS = [
  {
    id: 'snip-1',
    title: 'React 19 Hooks',
    content:
      'New hooks coming in React 19 allow for better optimistic updates and form handling. The useOptimistic hook is particularly useful for immediate UI feedback.',
    tags: ['React', 'Frontend'],
    source: 'Twitter',
    createdAt: '2023-10-25',
    linkedFileId: null,
    importance: 'high',
    aiSummary:
      'React 19 introduces hooks like useOptimistic to simplify optimistic UI updates and improve form handling experiences.',
  },
  {
    id: 'snip-2',
    title: 'Market Trend Q4',
    content:
      'Consumer spending is expected to rise by 4.5% in the technology sector due to AI adoption. Hardware sales are leading the charge.',
    tags: ['Business', 'Analysis'],
    source: 'Bloomberg',
    createdAt: '2023-10-24',
    linkedFileId: null,
    importance: 'medium',
  },
  {
    id: 'snip-3',
    title: 'Design System Principles',
    content:
      'Atomic design divides UI into atoms, molecules, organisms, templates, and pages. This methodology helps in creating scalable systems.',
    tags: ['UX', 'Design'],
    source: 'Medium',
    createdAt: '2023-10-20',
    linkedFileId: null,
    importance: 'low',
  },
  {
    id: 'snip-4',
    title: 'Competitor Pricing Model',
    content:
      'Competitor X has switched to a usage-based pricing model starting next month. We need to evaluate our flat-rate tiers.',
    tags: ['Strategy'],
    source: 'Internal Memo',
    createdAt: '2023-10-26',
    linkedFileId: null,
    importance: 'high',
  },
  {
    id: 'snip-5',
    title: 'Deployment Pipeline',
    content:
      'Remember to set the CI/CD environment variables before the next major release. The key for the staging DB has rotated.',
    tags: ['DevOps'],
    source: 'Slack',
    createdAt: '2023-10-27',
    linkedFileId: null,
    importance: 'medium',
  },
];


