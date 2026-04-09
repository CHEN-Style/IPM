import { registerTour } from '../TourProvider.jsx';

const steps = [
  {
    target: '[data-tour="sidebar-pin-btn"]',
    title: '展开侧边栏',
    content: '如果侧边栏处于收起状态，先点击底部的固定按钮将其展开。如果已展开，直接点击下一步。',
    placement: 'right',
  },
  {
    target: '[data-tour="workspace-menu-btn"]',
    title: '打开工作区菜单',
    content: '点击左上角 KnowVault Logo 展开工作区下拉菜单。',
    placement: 'right',
    advanceOn: 'click',
  },
  {
    target: '[data-tour="floating-mode-btn"]',
    title: '切换到悬浮模式',
    content: '点击「悬浮模式」即可将应用切换为小窗口悬浮形态，方便在使用其他软件时快速上传文件和捕获知识碎片。',
    placement: 'right',
    advanceOn: 'click',
    beforeStep: async () => {
      await delay(200);
    },
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

registerTour('floating-mode', steps);

export default steps;
