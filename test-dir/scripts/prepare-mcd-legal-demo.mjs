import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDirRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(testDirRoot, 'generated');

const CASE_STRUCTURE = [
  {
    relPath: '收到资料',
    description:
      '外部流入材料：客户/门店/第三方提交的原始资料、票据、照片、录音转写、往来函件等。通常是“输入型证据”，不代表律师最终观点。',
  },
  {
    relPath: '收到资料/客户提交',
    description:
      '客户/业务团队直接提交的基础案情材料：合同、补充协议、门店信息、主体资质、邮件导出。',
  },
  {
    relPath: '收到资料/证据原件',
    description:
      '证据原始载体及其固定版本：监控截图、聊天记录导出、公证材料、原始附件等。',
  },
  {
    relPath: '收到资料/财务票据',
    description:
      '费用票据及财务单据：发票、收据、对账单、付款凭证、损失清单原件。',
  },
  {
    relPath: '收到资料/财务票据/发票类',
    description:
      '费用与结算相关发票，包括增值税发票、服务费发票、补开发票。',
  },
  {
    relPath: '收到资料/财务票据/收据类',
    description:
      '收据、付款回执、现金收条等非标准发票类凭证。',
  },
  {
    relPath: '收到资料/外部来函',
    description:
      '监管/对方/第三方发送的函件、通知、律师函、协查函等。',
  },
  {
    relPath: '收到资料/外部来函/对方律师函',
    description:
      '对方代理律师发送的函件、证据清单、催告函、沟通纪要。',
  },
  {
    relPath: '过程文档',
    description:
      '律师团队内部工作过程产物：会议纪要、备忘录、工作底稿、版本迭代稿、证据整理草稿等。',
  },
  {
    relPath: '过程文档/庭前准备',
    description:
      '庭前任务拆解、证据编目、问题清单、法官关注点预判、庭审提纲草稿。',
  },
  {
    relPath: '过程文档/庭前准备/证据编排',
    description:
      '证据目录、证据三性标注、举证顺序草稿与附件对应关系。',
  },
  {
    relPath: '过程文档/庭审记录',
    description:
      '庭审会议纪要、谈话记录、庭后复盘、现场笔录整理稿。',
  },
  {
    relPath: '过程文档/内部讨论',
    description:
      '团队研讨文档：策略会议纪要、内部备忘录、风控讨论纪要。',
  },
  {
    relPath: '过程文档/版本迭代',
    description:
      '多版本工作稿：v1/v2/草稿/修订记录等，强调“未对外交付”的中间态。',
  },
  {
    relPath: '过程文档/版本迭代/内部review',
    description:
      '供内部评审的版本，包含批注、修改建议、合并意见。',
  },
  {
    relPath: '调研研究',
    description:
      '围绕争议焦点的法理与案例研究：法规检索、裁判规则梳理、专题分析、策略比较。',
  },
  {
    relPath: '调研研究/法规检索',
    description:
      '法律法规、司法解释、监管文件检索结果及适用要点摘录。',
  },
  {
    relPath: '调研研究/法规检索/劳动用工',
    description:
      '劳动关系认定、工伤赔偿、用工合规相关法规和裁判规则摘录。',
  },
  {
    relPath: '调研研究/案例研究',
    description:
      '类案、判例、裁判文书研究，含案情对比与裁判趋势归纳。',
  },
  {
    relPath: '调研研究/案例研究/加盟体系',
    description:
      '特许经营、加盟费返还、品牌授权边界相关类案。',
  },
  {
    relPath: '调研研究/专题分析',
    description:
      '针对单一争议点的深度分析报告，如违约金、证据采信、主体责任分配。',
  },
  {
    relPath: '调研研究/策略推演',
    description:
      '多路径策略评估：起诉/和解/调解方案比较，风险与收益测算。',
  },
  {
    relPath: '交付成果',
    description:
      '对外正式输出的成稿：法律意见书、定稿版诉讼文书、阶段性交付报告、结案成果包。',
  },
  {
    relPath: '交付成果/诉讼文书定稿',
    description:
      '已确认可对外使用的诉讼文书终版：起诉状、答辩状、证据目录、代理意见等。',
  },
  {
    relPath: '交付成果/诉讼文书定稿/客户签发',
    description:
      '已确认并可直接发给客户或法院渠道的签发版材料。',
  },
  {
    relPath: '交付成果/法律意见书',
    description:
      '面向业务方或管理层的正式法律意见终版，结论明确，可用于决策。',
  },
  {
    relPath: '交付成果/法律意见书/管理层版',
    description:
      '面向管理层汇报的高层摘要版意见书与结论页。',
  },
  {
    relPath: '交付成果/阶段性交付',
    description:
      '项目里程碑交付物：阶段进展汇报、风险评估终版、专项结论材料。',
  },
  {
    relPath: '交付成果/结案成果',
    description:
      '结案后沉淀成果：复盘报告、经验总结、可复用模板与结论摘要。',
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileIfChanged(filePath, content) {
  const next = Buffer.from(content, 'utf-8');
  if (fs.existsSync(filePath)) {
    const prev = fs.readFileSync(filePath);
    if (Buffer.compare(prev, next) === 0) return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, next);
  return true;
}

function makePlaceholderText(fileName, expectedFolder, expectedSubfolder) {
  return [
    `# Placeholder`,
    `fileName: ${fileName}`,
    `expectedFolder: ${expectedFolder}`,
    `expectedSubfolder: ${expectedSubfolder}`,
    `note: 此文件用于 AI 自动归档演示，内容为占位符。`,
    '',
  ].join('\n');
}

function buildDataset() {
  return [
    {
      fileName: 'MCD-LIT-2025Q2-华东租赁争议-客户发票清单-v1.xlsx',
      expectedFolder: '收到资料',
      expectedSubfolder: '收到资料/财务票据/发票类',
      namingStyle: 'strict',
      reason: '命中关键词：发票',
    },
    {
      fileName: '2025-加盟体系争议_invoice_vendor_batch-03.pdf',
      expectedFolder: '收到资料',
      expectedSubfolder: '收到资料/财务票据/发票类',
      namingStyle: 'strict',
      reason: '命中关键词：invoice',
    },
    {
      fileName: '加盟案收据（补开）.pdf',
      expectedFolder: '收到资料',
      expectedSubfolder: '收到资料/财务票据/收据类',
      namingStyle: 'normal',
      reason: '命中关键词：收据',
    },
    {
      fileName: '门店租赁争议-对方来函（扫描件）.pdf',
      expectedFolder: '收到资料',
      expectedSubfolder: '收到资料/外部来函/对方律师函',
      namingStyle: 'normal',
      reason: '外部来函语义明显',
    },
    {
      fileName: 'LIT_CASE_2025_庭前会议纪要_证据三性_v2.docx',
      expectedFolder: '过程文档',
      expectedSubfolder: '过程文档/庭前准备/证据编排',
      namingStyle: 'strict',
      reason: '命中关键词：会议纪要',
    },
    {
      fileName: 'MCD-诉讼组-工作底稿-举证责任分配-v1.xlsx',
      expectedFolder: '过程文档',
      expectedSubfolder: '过程文档/版本迭代/内部review',
      namingStyle: 'strict',
      reason: '命中关键词：工作底稿',
    },
    {
      fileName: '庭前准备memo-先这样.docx',
      expectedFolder: '过程文档',
      expectedSubfolder: '过程文档/庭前准备',
      namingStyle: 'normal',
      reason: '命中关键词：memo',
    },
    {
      fileName: '谈话记录_店长沟通_5.12.docx',
      expectedFolder: '过程文档',
      expectedSubfolder: '过程文档/庭审记录',
      namingStyle: 'normal',
      reason: '命中关键词：谈话记录',
    },
    {
      fileName: '2025Q2_调研报告_特许经营解除_裁判口径_v1.docx',
      expectedFolder: '调研研究',
      expectedSubfolder: '调研研究/专题分析',
      namingStyle: 'strict',
      reason: '命中关键词：调研/报告',
    },
    {
      fileName: '案例分析-加盟费返还争议-先看这个.pptx',
      expectedFolder: '调研研究',
      expectedSubfolder: '调研研究/案例研究/加盟体系',
      namingStyle: 'normal',
      reason: '命中关键词：案例/分析',
    },
    {
      fileName: '法规检索清单（劳动关系认定）.docx',
      expectedFolder: '调研研究',
      expectedSubfolder: '调研研究/法规检索/劳动用工',
      namingStyle: 'normal',
      reason: '命中关键词：法规检索',
    },
    {
      fileName: 'LegalOpinion_华南广告纠纷_终版_v1.docx',
      expectedFolder: '交付成果',
      expectedSubfolder: '交付成果/法律意见书/管理层版',
      namingStyle: 'strict',
      reason: '命中关键词：终版',
    },
    {
      fileName: '交付成果_设备维保违约案_final_客户版.pptx',
      expectedFolder: '交付成果',
      expectedSubfolder: '交付成果/阶段性交付',
      namingStyle: 'strict',
      reason: '命中关键词：交付成果/final',
    },
    {
      fileName: '法律意见书-华东租赁案-终版（给管理层）.pdf',
      expectedFolder: '交付成果',
      expectedSubfolder: '交付成果/法律意见书/管理层版',
      namingStyle: 'normal',
      reason: '命中关键词：法律意见书/终版',
    },
    {
      fileName: '结案成果_供应商违约案_复盘版.docx',
      expectedFolder: '交付成果',
      expectedSubfolder: '交付成果/结案成果',
      namingStyle: 'normal',
      reason: '命中关键词：成果',
    },
  ];
}

function generateUploadFiles() {
  const dataset = buildDataset();
  const uploadAllDir = path.join(outputRoot, 'upload-ready', 'all-files');
  const byExpectedRoot = path.join(outputRoot, 'upload-ready', 'by-expected');
  fs.rmSync(path.join(outputRoot, 'upload-ready'), { recursive: true, force: true });
  ensureDir(uploadAllDir);
  ensureDir(byExpectedRoot);

  let written = 0;
  for (const row of dataset) {
    const content = makePlaceholderText(row.fileName, row.expectedFolder, row.expectedSubfolder);
    const allFile = path.join(uploadAllDir, row.fileName);
    const catFile = path.join(byExpectedRoot, row.expectedSubfolder, row.fileName);
    if (writeFileIfChanged(allFile, content)) written += 1;
    if (writeFileIfChanged(catFile, content)) written += 1;
  }

  const csvHeader = 'fileName,expectedFolder,expectedSubfolder,namingStyle,reason\n';
  const csvLines = dataset
    .map(
      (r) =>
        `"${r.fileName.replaceAll('"', '""')}","${r.expectedFolder}","${r.expectedSubfolder}","${r.namingStyle}","${r.reason}"`,
    )
    .join('\n');
  writeFileIfChanged(path.join(outputRoot, 'expected-mapping.csv'), csvHeader + csvLines + '\n');

  return { dataset, written };
}

function writeStructureTemplate() {
  const payload = {
    caseTemplateName: '麦当劳法务部诉讼 AI 演示模板',
    generatedAt: new Date().toISOString(),
    folders: CASE_STRUCTURE,
  };
  writeFileIfChanged(path.join(outputRoot, 'demo-case-structure.json'), JSON.stringify(payload, null, 2) + '\n');
}

function upsertFolderMeta(map, relPath, description) {
  const now = new Date().toISOString();
  const prev = map[relPath] && typeof map[relPath] === 'object' ? map[relPath] : {};
  map[relPath] = {
    ...prev,
    relPath,
    name: relPath.split('/').slice(-1)[0],
    description,
    system: false,
    createdAt: typeof prev.createdAt === 'string' ? prev.createdAt : now,
    updatedAt: now,
  };
}

function applyCaseStructure(caseDir) {
  const absCaseDir = path.resolve(caseDir);
  if (!fs.existsSync(absCaseDir)) {
    throw new Error(`caseDir 不存在：${absCaseDir}`);
  }

  for (const f of CASE_STRUCTURE) {
    ensureDir(path.join(absCaseDir, f.relPath));
  }

  const metaDir = path.join(absCaseDir, 'meta');
  ensureDir(metaDir);
  const structurePath = path.join(metaDir, 'structure.json');

  let doc = {
    schemaVersion: 1,
    projectName: path.basename(absCaseDir),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    folders: {},
  };
  if (fs.existsSync(structurePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        doc = {
          ...doc,
          ...parsed,
          folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
        };
      }
    } catch {
      // keep default doc
    }
  }

  for (const f of CASE_STRUCTURE) {
    upsertFolderMeta(doc.folders, f.relPath, f.description);
  }
  doc.updatedAt = new Date().toISOString();
  if (!doc.projectName) doc.projectName = path.basename(absCaseDir);

  fs.writeFileSync(structurePath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
}

function printHelp() {
  console.log(`
Usage:
  node test-dir/scripts/prepare-mcd-legal-demo.mjs [--case-dir "D:/.../cases/演示案件"]

What it does:
  1) 在 test-dir/generated 下生成:
     - demo-case-structure.json
     - expected-mapping.csv
     - upload-ready/all-files (可直接上传的演示文件)
     - upload-ready/by-expected (按期望分类分组)
  2) 若提供 --case-dir，则自动在该案件目录创建演示子文件夹并写入结构描述到 meta/structure.json
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  const caseDirFlagIdx = args.findIndex((a) => a === '--case-dir');
  const caseDir = caseDirFlagIdx >= 0 ? args[caseDirFlagIdx + 1] : '';
  if (caseDirFlagIdx >= 0 && !caseDir) {
    throw new Error('缺少 --case-dir 参数值');
  }

  ensureDir(outputRoot);
  writeStructureTemplate();
  const { dataset } = generateUploadFiles();

  if (caseDir) {
    applyCaseStructure(caseDir);
    console.log(`[OK] 已应用演示目录结构与描述: ${path.resolve(caseDir)}`);
  }

  console.log(`[OK] 已生成演示文件: ${dataset.length} 个（all-files 目录）`);
  console.log(`[OK] 输出目录: ${outputRoot}`);
}

main();
