import { registerTour } from '../TourProvider.jsx';

const steps = [
  {
    target: '[data-tour="nav-mydata"]',
    title: '进入「我的资料」',
    content: '点击侧边栏的「我的资料」进入资料管理页面。',
    placement: 'right',
    advanceOn: 'click',
  },
  {
    target: '[data-tour="section-projects"]',
    title: '进入「项目」空间',
    content: '点击「项目」卡片进入项目列表。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async ({ navigate }) => {
      navigate('mydata');
      await delay(300);
    },
  },
  {
    target: '[data-tour="btn-knowledge-first"]',
    title: '打开知识管理',
    content: '点击项目行右侧的「知识管理」按钮，进入该项目的知识碎片管理页面。',
    placement: 'left',
    advanceOn: 'click',
    beforeStep: async ({ navigate, setMyDataSection }) => {
      navigate('mydata');
      setMyDataSection('projects');
      await delay(400);
    },
  },
  {
    target: '[data-tour="knowledge-create-btn"]',
    title: '点击「新建」',
    content: '点击右上角的「新建」按钮展开创建菜单。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async () => {
      await delay(500);
    },
  },
  {
    target: '[data-tour="knowledge-create-note"]',
    title: '选择「富文本笔记」',
    content: '点击「富文本笔记」选项，将弹出标题输入框。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async () => {
      await delay(200);
    },
  },
  {
    target: '[data-tour="knowledge-note-title"]',
    title: '输入笔记标题',
    content: '输入一个笔记标题，例如「会议记录」。输入完成后点击下一步。',
    placement: 'bottom',
    beforeStep: async () => {
      await delay(300);
    },
  },
  {
    target: '[data-tour="knowledge-note-confirm"]',
    title: '确认创建（教程结束）',
    content: '点击「创建」按钮完成笔记碎片的创建。创建后会自动进入富文本编辑器，你可以在其中编写详细内容。',
    placement: 'bottom',
    advanceOn: 'click',
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

registerTour('create-note', steps);

export default steps;
