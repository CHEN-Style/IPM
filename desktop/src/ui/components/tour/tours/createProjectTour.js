import { registerTour } from '../TourProvider.jsx';

const steps = [
  {
    target: '[data-tour="nav-mydata"]',
    title: '进入「我的资料」',
    content: '点击侧边栏的「我的资料」进入资料管理页面，这里是管理你所有项目和案件的入口。',
    placement: 'right',
    advanceOn: 'click',
  },
  {
    target: '[data-tour="section-projects"]',
    title: '进入「项目」空间',
    content: '点击「项目」卡片进入项目列表。项目空间用于存放合规建设、知识迁移等文件资料。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async ({ navigate }) => {
      navigate('mydata');
      await delay(300);
    },
  },
  {
    target: '[data-tour="input-project-name"]',
    title: '输入项目名称',
    content: '在输入框中输入你想要创建的项目名称，例如「演示项目」。输入完成后点击下一步。',
    placement: 'bottom',
    beforeStep: async ({ navigate, setMyDataSection }) => {
      navigate('mydata');
      setMyDataSection('projects');
      await delay(400);
    },
  },
  {
    target: '[data-tour="btn-create-confirm"]',
    title: '确认创建项目',
    content: '点击「新建项目」按钮完成项目创建。创建成功后项目会出现在下方列表中。',
    placement: 'bottom',
    advanceOn: 'click',
  },
  {
    target: '[data-tour="project-card-first"]',
    title: '进入项目',
    content: '点击列表中的项目进入项目内部。进入后你会看到默认的文件夹结构，包括 temp 临时文件夹等。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async () => {
      await delay(500);
    },
  },
  {
    target: '[data-tour="btn-upload"]',
    title: '上传文件',
    content: '点击「上传文件」按钮可以选择本地文件上传到当前位置。你也可以直接将文件拖拽到页面中进行上传。',
    placement: 'bottom',
    beforeStep: async () => {
      await delay(400);
    },
  },
  {
    target: '[data-tour="btn-ai-upload"]',
    title: '上传并 AI 分类（教程结束）',
    content: '「上传并 AI 分类」会将文件先放入 temp 文件夹，然后 AI 会自动分析文件内容并推荐放入合适的文件夹。恭喜你完成了基础操作教程！',
    placement: 'bottom',
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

registerTour('create-project', steps);

export default steps;
