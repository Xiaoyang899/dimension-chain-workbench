import { createProject, createRow } from './model.js';

const NAMES = ['端盖轴向间隙分析', '摇臂装配间隙分析', '轴套定位尺寸分析'];

export function createSample(index = 0) {
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new RangeError('样例索引必须为 0、1 或 2');
  const project = createProject();
  project.name = NAMES[index];
  const specifications = [
    [[30, -1, 0, -.1], [5, -1, 0, -.05], [43, 1, .2, .1], [3, -1, 0, -.05], [5, -1, 0, -.05]],
    [[29.7, -1, .1, -.1], [4.3, 1, .05, -.05], [20, 1, .1, -.1], [5.3, 1, .1, -.1], [0, -1, .1, -.1]],
    [[1.5, -1, .05, -.05], [15, 1, .15, -.15], [2, -1, .05, -.05], [7, -1, .15, -.15]],
  ];
  project.rows = specifications[index].map(([nominal, direction, upperDeviation, lowerDeviation], i) => ({
    ...createRow(i), nominal, direction, upperDeviation, lowerDeviation, symmetric: index !== 0,
    note: index === 0 ? '参考工作簿 Sample1；按非对称偏差计算。' : `参考工作簿 Sample${index + 1}；按已启用的对称模式取 EI = −ES。`,
  }));
  project.target = [{ lower: .15, upper: .4 }, { lower: -.3, upper: .1 }, { lower: 4.2, upper: 4.8 }][index];
  return project;
}
