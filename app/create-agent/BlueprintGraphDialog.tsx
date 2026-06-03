'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function buildBlueprintFlow(blueprint: any): { nodes: Node[]; edges: Edge[] } {
  const scenes = blueprint?.scenes || [];
  const actions = blueprint?.actions || [];
  const accusation = blueprint?.accusation;
  const failState = blueprint?.failState;
  const targets = [
    ...(blueprint?.suspects || []).map((item: any) => ({ ...item, kind: '嫌疑人', group: 'suspect' })),
    ...(blueprint?.clues || []).map((item: any) => ({ ...item, kind: '线索', group: 'clue' })),
    ...(blueprint?.objects || []).map((item: any) => ({ ...item, kind: '物件', group: 'object' })),
    ...(blueprint?.endings || []).map((item: any) => ({ ...item, kind: '结局', group: 'ending' })),
  ];
  const targetIds = new Set(targets.map((target: any) => target.id));
  const actionIds = new Set(actions.map((action: any) => action.id));

  const nodes: Node[] = [
    ...scenes.map((scene: any, index: number) => ({
      id: `scene:${scene.id}`,
      position: { x: 0, y: index * 110 },
      data: { label: `${scene.name || scene.id}\n${scene.id}` },
      style: {
        width: 190,
        border: '1px solid rgba(103,232,249,0.35)',
        background: 'rgba(6,182,212,0.16)',
        color: 'white',
        borderRadius: 12,
        whiteSpace: 'pre-line',
      },
    })),
    ...actions.map((action: any, index: number) => ({
      id: `action:${action.id}`,
      position: { x: 300, y: index * 92 },
      data: { label: `${action.label || action.id}\n${action.intent || 'action'}` },
      style: {
        width: 210,
        border: '1px solid rgba(196,181,253,0.35)',
        background: 'rgba(139,92,246,0.16)',
        color: 'white',
        borderRadius: 12,
        whiteSpace: 'pre-line',
      },
    })),
    ...(accusation
      ? [
          {
            id: 'accusation',
            position: { x: 300, y: (actions.length + 1) * 92 },
            data: { label: `指认规则\n${accusation.correctSuspectId || ''}` },
            style: {
              width: 210,
              border: '1px solid rgba(251,191,36,0.42)',
              background: 'rgba(251,191,36,0.16)',
              color: 'white',
              borderRadius: 12,
              whiteSpace: 'pre-line',
            },
          },
        ]
      : []),
    ...(failState
      ? [
          {
            id: 'failState',
            position: { x: 300, y: (actions.length + (accusation ? 2 : 1)) * 92 },
            data: { label: `失败规则\n${failState.maxActionCount || ''} actions` },
            style: {
              width: 210,
              border: '1px solid rgba(248,113,113,0.42)',
              background: 'rgba(248,113,113,0.16)',
              color: 'white',
              borderRadius: 12,
              whiteSpace: 'pre-line',
            },
          },
        ]
      : []),
    ...targets.map((target: any, index: number) => ({
      id: `target:${target.id}`,
      position: { x: 640, y: index * 88 },
      data: { label: `${target.name || target.id}\n${target.kind}` },
      style: {
        width: 190,
        border: '1px solid rgba(110,231,183,0.28)',
        background: 'rgba(16,185,129,0.14)',
        color: 'white',
        borderRadius: 12,
        whiteSpace: 'pre-line',
      },
    })),
  ];

  const sceneEdges: Edge[] = scenes.flatMap((scene: any) =>
    (scene.actionIds || [])
      .filter((actionId: string) => actionIds.has(actionId))
      .map((actionId: string) => ({
        id: `scene:${scene.id}->action:${actionId}`,
        source: `scene:${scene.id}`,
        target: `action:${actionId}`,
        animated: false,
        style: { stroke: 'rgba(255,255,255,0.35)' },
      }))
  );

  const actionEdges: Edge[] = actions.flatMap((action: any) => {
    const ids = new Set<string>();
    if (action.targetId) ids.add(action.targetId);
    for (const effect of action.effects || []) {
      if (effect.clueId) ids.add(effect.clueId);
      if (effect.endingId) ids.add(effect.endingId);
    }
    return Array.from(ids)
      .filter((targetId) => targetIds.has(targetId))
      .map((targetId) => ({
        id: `action:${action.id}->target:${targetId}`,
        source: `action:${action.id}`,
        target: `target:${targetId}`,
        style: { stroke: 'rgba(255,255,255,0.25)' },
      }));
  });

  const accusationEdges: Edge[] = accusation
    ? [
        accusation.correctSuspectId,
        ...(accusation.requiredClueIds || []),
        accusation.successEndingId,
        accusation.failureEndingId,
      ]
        .filter((targetId: string) => targetIds.has(targetId))
        .map((targetId: string) => ({
          id: `accusation->target:${targetId}`,
          source: 'accusation',
          target: `target:${targetId}`,
          animated: targetId === accusation.successEndingId || targetId === accusation.failureEndingId,
          style: { stroke: 'rgba(251,191,36,0.52)' },
        }))
    : [];
  const failStateEdges: Edge[] =
    failState && targetIds.has(failState.endingId)
      ? [
          {
            id: `failState->target:${failState.endingId}`,
            source: 'failState',
            target: `target:${failState.endingId}`,
            animated: true,
            style: { stroke: 'rgba(248,113,113,0.52)' },
          },
        ]
      : [];

  return { nodes, edges: [...sceneEdges, ...actionEdges, ...accusationEdges, ...failStateEdges] };
}

export default function BlueprintGraphDialog({
  blueprint,
  open,
  onClose,
}: {
  blueprint: any;
  open: boolean;
  onClose: () => void;
}) {
  const { nodes, edges } = useMemo(() => buildBlueprintFlow(blueprint), [blueprint]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#19172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-sm font-black text-white">关系图</div>
            <div className="mt-1 text-xs text-white/40">可拖拽、缩放、平移；当前为只读查看。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/[0.08] px-4 py-2 text-xs font-black text-white/64 transition hover:bg-white/[0.12] hover:text-white"
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.18 }}>
            <Background color="rgba(255,255,255,0.18)" gap={18} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
