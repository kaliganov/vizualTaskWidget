import {
  analyzeGraph,
  finishDateFrom,
  formatEstimate,
  plannedDates,
  toDays,
  type PathEdge,
  type PathNode,
} from './schedule';

function task(
  id: string,
  estimateValue: number,
  plannedStart = '2026-08-01',
  estimateUnit = 'day',
): PathNode {
  return {
    id,
    type: 'task',
    estimateValue,
    estimateUnit,
    plannedStart,
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
): PathEdge {
  return { id, sourceNodeId, targetNodeId };
}

/** Эталон §13: цепочка 3+5+4+0 = 12, витрина короче, закупка 100 дней вне маршрута. */
function referenceGraph(startOfCritical = '2026-08-01') {
  const nodes: PathNode[] = [
    task('db', 3, startOfCritical),
    task('api', 5, startOfCritical),
    task('pay', 4, startOfCritical),
    task('ui', 2, '2026-08-01'),
    task('cat', 4, '2026-08-01'),
    task('cart', 3, '2026-08-01'),
    task('qa', 0, startOfCritical),
    {
      id: 'goal',
      type: 'goal_anchor',
      estimateValue: 0,
      estimateUnit: 'day',
      plannedStart: '2026-08-01',
    },
    task('lone', 100, '2026-08-01'),
  ];
  const edges = [
    edge('e-db', 'db', 'api'),
    edge('e-api', 'api', 'pay'),
    edge('e-pay', 'pay', 'qa'),
    edge('e-ui', 'ui', 'cat'),
    edge('e-cat', 'cat', 'cart'),
    edge('e-cart', 'cart', 'qa'),
    edge('e-qa', 'qa', 'goal'),
  ];
  return { nodes, edges };
}

describe('время и критический путь', () => {
  it('переводит единицы в дни', () => {
    expect(toDays(4, 'hour')).toBe(0.5);
    expect(toDays(3, 'day')).toBe(3);
    expect(toDays(2, 'week')).toBe(14);
    expect(() => toDays(1, 'month')).toThrow(/BAD_ESTIMATE/);
  });

  it('форматирует подпись оценки', () => {
    expect(formatEstimate(5, 'day')).toBe('5д');
    expect(formatEstimate(4, 'hour')).toBe('4ч');
    expect(formatEstimate(2, 'week')).toBe('2нед');
    expect(formatEstimate(0, 'day')).toBe('0д');
  });

  it('считает plannedEnd для 3 дней и 4 часов', () => {
    expect(plannedDates('2026-09-01', 0, 3, 'day')).toEqual({
      plannedStart: '2026-09-01',
      plannedEnd: '2026-09-04',
    });
    expect(plannedDates('2026-09-01', 0, 4, 'hour')).toEqual({
      plannedStart: '2026-09-01',
      plannedEnd: '2026-09-02',
    });
    expect(plannedDates('2026-08-01', 0, 4, 'day').plannedEnd).toBe(
      '2026-08-05',
    );
    expect(plannedDates('2026-08-01', 0, 0, 'day').plannedEnd).toBe(
      '2026-08-01',
    );
  });

  it('эталон §13: длина 12, путь db-api-pay-qa, закупка не входит', () => {
    const { nodes, edges } = referenceGraph();
    const result = analyzeGraph(nodes, edges, '2026-11-01');
    expect(result.criticalLengthDays).toBe(12);
    expect(result.criticalNodeIds).toEqual(['api', 'db', 'pay', 'qa']);
    expect(result.criticalEdgeIds).toEqual(['e-api', 'e-db', 'e-pay', 'e-qa']);
    for (const id of ['ui', 'cat', 'cart', 'lone', 'goal']) {
      expect(result.criticalNodeIds).not.toContain(id);
    }
    expect(result.finishDate).toBe('2026-08-13');
    expect(finishDateFrom('2026-08-01', 12)).toBe('2026-08-13');
    expect(result.deadlineExceeded).toBe(false);
  });

  it('сдвиг критических задач на 2026-10-25 даёт финиш 2026-11-06', () => {
    const { nodes, edges } = referenceGraph('2026-10-25');
    const result = analyzeGraph(nodes, edges, '2026-11-01');
    expect(result.criticalNodeIds).toEqual(['api', 'db', 'pay', 'qa']);
    expect(result.criticalLengthDays).toBe(12);
    expect(result.finishDate).toBe('2026-11-06');
    expect(result.deadlineExceeded).toBe(true);
  });

  it('две равные цепочки подсвечиваются целиком', () => {
    const nodes: PathNode[] = [
      task('a', 5),
      task('b', 5),
      {
        id: 'goal',
        type: 'goal_anchor',
        estimateValue: 0,
        estimateUnit: 'day',
        plannedStart: '2026-08-01',
      },
    ];
    const edges = [edge('ea', 'a', 'goal'), edge('eb', 'b', 'goal')];
    const result = analyzeGraph(nodes, edges, '2026-11-01');
    expect(result.criticalLengthDays).toBe(5);
    expect(result.criticalNodeIds).toEqual(['a', 'b']);
    expect(result.criticalEdgeIds).toEqual(['ea', 'eb']);
  });

  it('4 часа дают вклад 0.5 и не красят маршрут нулевой длины', () => {
    const half = analyzeGraph(
      [
        task('h', 4, '2026-09-01', 'hour'),
        {
          id: 'goal',
          type: 'goal_anchor',
          estimateValue: 0,
          estimateUnit: 'day',
          plannedStart: '2026-09-01',
        },
      ],
      [edge('eh', 'h', 'goal')],
      '2026-11-01',
    );
    expect(half.criticalLengthDays).toBe(0.5);
    expect(half.criticalNodeIds).toEqual(['h']);

    const zero = analyzeGraph(
      [
        task('z', 0),
        {
          id: 'goal',
          type: 'goal_anchor',
          estimateValue: 0,
          estimateUnit: 'day',
          plannedStart: '2026-08-01',
        },
      ],
      [edge('ez', 'z', 'goal')],
      '2026-11-01',
    );
    expect(zero.criticalLengthDays).toBe(0);
    expect(zero.criticalNodeIds).toEqual([]);
    expect(zero.criticalEdgeIds).toEqual([]);
    expect(zero.deadlineExceeded).toBe(false);
  });
});
