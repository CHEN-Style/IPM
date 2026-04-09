import { registerTour } from '../TourProvider.jsx';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    content: '点击「项目」卡片进入项目列表，确保你已经创建了至少一个项目。',
    placement: 'bottom',
    advanceOn: 'click',
    beforeStep: async ({ navigate }) => {
      navigate('mydata');
      await delay(300);
    },
  },
  {
    target: '[data-tour="btn-preferences-first"]',
    title: '打开「偏好与记录」',
    content: '点击项目行中的「偏好与记录」按钮，进入该项目的分类规则管理页面。',
    placement: 'left',
    advanceOn: 'click',
    beforeStep: async ({ navigate, setMyDataSection }) => {
      navigate('mydata');
      setMyDataSection('projects');
      await delay(400);
    },
  },
  {
    target: '[data-tour="pref-tab-rules"]',
    title: '确认在「硬规则」标签页',
    content: '偏好与记录页面默认就在「硬规则」标签。硬规则是确定性的快速通道，命中后跳过 AI 直接将文件分入指定文件夹。',
    placement: 'bottom',
    beforeStep: async () => {
      await delay(500);
    },
  },
  {
    target: '[data-tour="rules-add-btn"]',
    title: '点击「添加规则」',
    content: '点击底部的「添加规则」按钮，展开规则创建表单。',
    placement: 'top',
    advanceOn: 'click',
  },
  {
    target: '[data-tour="rules-form-label"]',
    title: '填写规则名称',
    content: '输入一个易于识别的规则名称，例如「草稿类文件归档」。此名称仅用于管理标识。',
    placement: 'bottom',
    beforeStep: async () => {
      await delay(300);
    },
  },
  {
    target: '[data-tour="rules-form-folder"]',
    title: '选择目标文件夹',
    content: '从下拉列表中选择一个文件夹作为规则命中后的归档目标。列表中会显示项目下所有非系统文件夹。',
    placement: 'bottom',
  },
  {
    target: '[data-tour="rules-form-keywords"]',
    title: '设置匹配关键词',
    content: '输入文件名需包含的关键词，多个关键词用逗号分隔。只要文件名包含其中任一关键词即视为命中。',
    placement: 'bottom',
  },
  {
    target: '[data-tour="rules-form-submit"]',
    title: '提交规则（教程结束）',
    content: '确认所有信息填写完毕后，点击「添加规则」完成创建。新规则会立即生效，后续上传的文件如果命中条件会自动归入目标文件夹。',
    placement: 'top',
  },
];

registerTour('create-hard-rule', steps);

export default steps;
