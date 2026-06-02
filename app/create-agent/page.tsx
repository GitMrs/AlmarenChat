'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  Loader2,
  Lock,
  MapPin,
  Palette,
  RefreshCw,
  Scroll,
  Search,
  Sparkles,
  Workflow,
  Wand2,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';
import { CATEGORIES, TONES, CATEGORY_COLORS } from '@/types';
import { agents, auth } from '@/lib/api';

const AVATAR_OPTIONS = ['🎭', '🏰', '🔍', '💜', '⚔️', '🌟', '👻', '🎪', '🧩', '🗡️', '📖', '🌙', '🔮', '🎯', '🏴‍☠️', '🦋'];

type CreationType = 'mystery' | 'world' | 'character' | 'script';

interface CreationTypeOption {
  id: CreationType;
  name: string;
  icon: string;
  description: string;
  color: string;
}

const CREATION_TYPES: CreationTypeOption[] = [
  {
    id: 'mystery',
    name: '谜案推理',
    icon: '🔍',
    description: '创建一个结构化的推理案件，包含嫌疑人、线索、真相和多个结局。',
    color: '#6366f1',
  },
  {
    id: 'world',
    name: '故事世界',
    icon: '🏰',
    description: '创建一个广阔的可探索世界，包含地点、角色、规则和目标。',
    color: '#06b6d4',
  },
  {
    id: 'character',
    name: '角色扮演',
    icon: '🎭',
    description: '创建一个独特的角色或 NPC，包含性格、说话风格和背景故事。',
    color: '#8b5cf6',
  },
  {
    id: 'script',
    name: '互动剧本',
    icon: '📖',
    description: '创建一个分支故事，包含选择、触发事件和多个结局。',
    color: '#f59e0b',
  },
];

interface AccordionSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
}

const MYSTERY_SECTIONS: AccordionSection[] = [
  { id: 'concept', title: '嫌疑人与核心诡计', icon: <Search size={18} />, color: '#6366f1' },
  { id: 'clues', title: '线索与干扰项', icon: <BookOpen size={18} />, color: '#8b5cf6' },
  { id: 'truth', title: '真相与结局', icon: <MapPin size={18} />, color: '#f43f5e' },
  { id: 'opening', title: '场景与开场', icon: <Scroll size={18} />, color: '#10b981' },
  { id: 'blueprint', title: '案件骨架', icon: <Workflow size={18} />, color: '#06b6d4' },
];

function truncateLabel(value: string, max = 16) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

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

function BlueprintGraphDialog({
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

function CreateAgentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingAgentId = searchParams.get('agentId');

  // Core state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('悬疑推理');
  const [tone, setTone] = useState('悬疑');
  const [greeting, setGreeting] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🎭');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<boolean | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);

  // Creation flow state
  const [creationType, setCreationType] = useState<CreationType | null>(null);
  const [activeTab, setActiveTab] = useState('concept');
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  // Mystery Case fields (manual or AI-assisted)
  const [concept, setConcept] = useState('');
  const [suspects, setSuspects] = useState<any[]>([]);
  const [coreTrick, setCoreTrick] = useState('');
  const [clues, setClues] = useState<any[]>([]);
  const [redHerrings, setRedHerrings] = useState<any[]>([]);
  const [truth, setTruth] = useState<any>(null);
  const [solutionCondition, setSolutionCondition] = useState('');
  const [endings, setEndings] = useState<any[]>([]);
  const [openingScene, setOpeningScene] = useState('');
  const [crimeScene, setCrimeScene] = useState('');
  const [generatedGreeting, setGeneratedGreeting] = useState('');
  const [generatedSystemPrompt, setGeneratedSystemPrompt] = useState('');
  const [blueprint, setBlueprint] = useState<any>(null);
  const [blueprintGraphOpen, setBlueprintGraphOpen] = useState(false);
  const [blueprintView, setBlueprintView] = useState<'overview' | 'evidence' | 'diagnostics' | 'json'>('overview');
  const [checkingBlueprint, setCheckingBlueprint] = useState(false);
  const [characterConcept, setCharacterConcept] = useState('');
  const [characterIdentity, setCharacterIdentity] = useState('');
  const [characterPersonality, setCharacterPersonality] = useState('');
  const [characterSpeakingStyle, setCharacterSpeakingStyle] = useState('');
  const [characterScenario, setCharacterScenario] = useState('');
  const [characterRelationship, setCharacterRelationship] = useState('');
  const [characterBoundaries, setCharacterBoundaries] = useState<string[]>([]);
  const [characterExampleDialogues, setCharacterExampleDialogues] = useState<any[]>([]);
  const [characterWorldNotes, setCharacterWorldNotes] = useState<string[]>([]);
  const [characterSkillCards, setCharacterSkillCards] = useState<any[]>([]);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      return;
    }

    auth
      .me()
      .then(async () => {
        setNeedsLogin(false);
        if (!editingAgentId) return;

        setLoadingAgent(true);
        try {
          const result = await agents.get(editingAgentId);
          const agent = result.agent;
          setName(agent.name || '');
          setDescription(agent.description || '');
          setCategory(agent.category || '悬疑推理');
          setTone(agent.tone || '悬疑');
          setGreeting(agent.greeting || '');
          setSystemPrompt(agent.systemPrompt || '');
          setSelectedAvatar(agent.avatar || '🎭');
          setIsPublic(Boolean(agent.isPublic));

          if (agent.creationType) {
            setCreationType(agent.creationType as CreationType);
          }
          if (agent.builderConfig) {
            try {
              const config = JSON.parse(agent.builderConfig);
              setConcept(config.concept || '');
              setSuspects(config.suspects || []);
              setCoreTrick(config.coreTrick || '');
              setClues(config.clues || []);
              setRedHerrings(config.redHerrings || []);
              setTruth(config.truth || null);
              setSolutionCondition(config.solutionCondition || '');
              setEndings(config.endings || []);
              setOpeningScene(config.openingScene || '');
              setCrimeScene(config.crimeScene || '');
              setGeneratedGreeting(config.greeting || '');
              setGeneratedSystemPrompt(config.systemPrompt || '');
              setBlueprint(config.blueprint || null);
              setCharacterConcept(config.characterConcept || '');
              setCharacterIdentity(config.identity || '');
              setCharacterPersonality(config.personality || '');
              setCharacterSpeakingStyle(config.speakingStyle || '');
              setCharacterScenario(config.scenario || '');
              setCharacterRelationship(config.relationshipToPlayer || '');
              setCharacterBoundaries(config.boundaries || []);
              setCharacterExampleDialogues(config.exampleDialogues || []);
              setCharacterWorldNotes(config.worldNotes || []);
              setCharacterSkillCards(config.skillCards || []);
            } catch {}
          }
        } finally {
          setLoadingAgent(false);
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        setNeedsLogin(true);
      });
  }, [editingAgentId]);

  const categoryColor = CATEGORY_COLORS[category] || '#6366f1';
  const publishChecks = [
    { label: '嫌疑人', done: suspects.length >= 3 },
    { label: '线索', done: clues.length >= 3 },
    { label: '真相', done: Boolean(truth?.killer) },
    { label: '开场', done: Boolean(openingScene.trim()) || Boolean(generatedGreeting.trim()) },
  ];
  const completedSections = publishChecks.filter((c) => c.done).length;
  const mysteryReady = publishChecks.every((c) => c.done);
  const characterReady =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    characterIdentity.trim().length > 0 &&
    characterPersonality.trim().length > 0 &&
    characterSpeakingStyle.trim().length > 0;
  const canCreate =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    category &&
    tone &&
    (creationType !== 'mystery' || mysteryReady) &&
    (creationType !== 'character' || characterReady);

  const canGenerateSection = (sectionId: string) => {
    if (sectionId === 'concept') return concept.trim().length > 0;
    if (sectionId === 'clues') return suspects.length > 0 && Boolean(coreTrick.trim());
    if (sectionId === 'truth') return suspects.length > 0 && clues.length > 0;
    if (sectionId === 'opening') return Boolean(truth?.killer) && endings.length > 0;
    if (sectionId === 'blueprint') return Boolean(truth?.killer) && clues.length > 0 && endings.length > 0 && Boolean(openingScene || generatedGreeting);
    if (sectionId === 'character_base') return characterConcept.trim().length > 0;
    if (sectionId === 'character_details') return Boolean(name.trim()) && Boolean(characterIdentity.trim());
    if (sectionId === 'character_assets') return Boolean(name.trim()) && Boolean(characterIdentity.trim());
    return true;
  };

  const getGenerateHint = (sectionId: string) => {
    if (sectionId === 'concept') return '先写一句案件概念';
    if (sectionId === 'clues') return '请先生成嫌疑人和核心诡计';
    if (sectionId === 'truth') return '请先补充嫌疑人和线索';
    if (sectionId === 'opening') return '请先生成真相和结局';
    if (sectionId === 'blueprint') return 'Please complete truth, endings, and opening first';
    if (sectionId === 'character_base') return '先写一句角色概念';
    if (sectionId === 'character_details') return '请先生成或填写角色基础设定';
    if (sectionId === 'character_assets') return '请先生成或填写角色基础设定';
    return '';
  };

  const finalGreeting = useMemo(() => {
    if (greeting.trim()) return greeting;
    if (generatedGreeting) return generatedGreeting;
    if (creationType === 'character' && name.trim()) {
      return `你好，我是${name}。${characterScenario || '接下来，我们可以从这里开始。'}`;
    }
    if (!name.trim()) return '欢迎来到这个世界。你的冒险从这里开始。';
    return `欢迎来到${name}。你的冒险从这里开始。`;
  }, [characterScenario, creationType, greeting, generatedGreeting, name]);

  const finalPrompt = useMemo(() => {
    if (systemPrompt.trim()) return systemPrompt;
    if (generatedSystemPrompt) return generatedSystemPrompt;
    if (creationType === 'character') {
      return [
        `你正在扮演角色：${name || '未命名角色'}。`,
        characterIdentity ? `身份背景：${characterIdentity}` : '',
        characterPersonality ? `性格特征：${characterPersonality}` : '',
        characterSpeakingStyle ? `说话风格：${characterSpeakingStyle}` : '',
        characterScenario ? `当前情境：${characterScenario}` : '',
        characterRelationship ? `与用户关系：${characterRelationship}` : '',
        characterWorldNotes.length > 0 ? `世界资料：\n${characterWorldNotes.map((note) => `- ${note}`).join('\n')}` : '',
        characterSkillCards.length > 0
          ? `技能卡：\n${characterSkillCards
              .map((skill) =>
                [
                  `【${skill.name || '未命名技能'}】`,
                  skill.trigger ? `触发：${skill.trigger}` : '',
                  skill.instruction ? `行为：${skill.instruction}` : '',
                  skill.boundaries ? `边界：${skill.boundaries}` : '',
                  skill.example ? `示例：${skill.example}` : '',
                ].filter(Boolean).join('\n')
              )
              .join('\n\n')}`
          : '',
        characterBoundaries.length > 0 ? `边界：${characterBoundaries.join('；')}` : '',
        '你需要始终保持角色一致，用自然对话回应用户，不要替用户做决定。',
      ].filter(Boolean).join('\n');
    }
    return `你是一个${category}类型的故事世界。氛围风格是${tone}。你需要引导玩家进入故事，做出选择，推动剧情发展。`;
  }, [
    category,
    characterBoundaries,
    characterIdentity,
    characterPersonality,
    characterRelationship,
    characterScenario,
    characterSkillCards,
    characterSpeakingStyle,
    characterWorldNotes,
    creationType,
    generatedSystemPrompt,
    name,
    systemPrompt,
    tone,
  ]);

  // AI Generate for a specific section
  const handleGenerate = async (sectionId: string) => {
    if (generatingSection) return;
    if (!canGenerateSection(sectionId)) {
      alert(getGenerateHint(sectionId));
      return;
    }
    setGeneratingSection(sectionId);

    try {
      let step = 1;
      let confirmedData: Record<string, any> = {};

      if (sectionId === 'concept') {
        step = 1;
        confirmedData = { concept };
      } else if (sectionId === 'clues') {
        step = 2;
        confirmedData = { suspects, coreTrick, concept };
      } else if (sectionId === 'truth') {
        step = 3;
        confirmedData = { suspects, clues, concept };
      } else if (sectionId === 'opening') {
        step = 4;
        confirmedData = { suspects, clues, truth, endings, solutionCondition, concept };
      } else if (sectionId === 'blueprint') {
        step = 5;
        confirmedData = {
          concept,
          suspects,
          coreTrick,
          clues,
          redHerrings,
          truth,
          solutionCondition,
          endings,
          openingScene,
          crimeScene,
          greeting: generatedGreeting,
        };
      } else if (sectionId === 'character_base') {
        step = 1;
        confirmedData = { concept: characterConcept };
      } else if (sectionId === 'character_details') {
        step = 2;
        confirmedData = {
          name,
          identity: characterIdentity,
          personality: characterPersonality,
          speakingStyle: characterSpeakingStyle,
          scenario: characterScenario,
        };
      } else if (sectionId === 'character_assets') {
        step = 3;
        confirmedData = {
          name,
          description,
          identity: characterIdentity,
          personality: characterPersonality,
          speakingStyle: characterSpeakingStyle,
          scenario: characterScenario,
          relationshipToPlayer: characterRelationship,
          boundaries: characterBoundaries,
          existingWorldNotes: characterWorldNotes,
          existingSkillCards: characterSkillCards,
        };
      }

      const response = await fetch('/api/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          creationType,
          step,
          concept,
          confirmedData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      const result = await response.json();
      const data = result.data;

      // Apply generated data to fields
      if (sectionId === 'concept') {
        if (data.suspects) setSuspects(data.suspects);
        if (data.coreTrick) setCoreTrick(data.coreTrick);
        if (!name) setName('未命名谜案');
        if (!description && data.coreTrick) setDescription(data.coreTrick.slice(0, 100));
      } else if (sectionId === 'clues') {
        if (data.clues) setClues(data.clues);
        if (data.redHerrings) setRedHerrings(data.redHerrings);
      } else if (sectionId === 'truth') {
        if (data.truth) setTruth(data.truth);
        if (data.solutionCondition) setSolutionCondition(data.solutionCondition);
        if (data.endings) setEndings(data.endings);
      } else if (sectionId === 'opening') {
        if (data.openingScene) setOpeningScene(data.openingScene);
        if (data.crimeScene) setCrimeScene(data.crimeScene);
        if (data.greeting) setGeneratedGreeting(data.greeting);
        if (data.systemPrompt) setGeneratedSystemPrompt(data.systemPrompt);
      } else if (sectionId === 'blueprint') {
        if (data.blueprint) setBlueprint(data.blueprint);
      } else if (sectionId === 'character_base') {
        if (data.name) setName(data.name);
        if (data.identity) {
          setCharacterIdentity(data.identity);
          if (!description) setDescription(data.identity.slice(0, 120));
        }
        if (data.personality) setCharacterPersonality(data.personality);
        if (data.speakingStyle) setCharacterSpeakingStyle(data.speakingStyle);
        if (data.scenario) setCharacterScenario(data.scenario);
        if (data.relationshipToPlayer && !characterRelationship) setCharacterRelationship(data.relationshipToPlayer);
        if (data.boundaries && characterBoundaries.length === 0) setCharacterBoundaries(data.boundaries);
        setCategory('角色扮演');
        setTone('沉浸');
        setSelectedAvatar('🎭');
      } else if (sectionId === 'character_details') {
        if (data.relationshipToPlayer) setCharacterRelationship(data.relationshipToPlayer);
        if (data.boundaries) setCharacterBoundaries(data.boundaries);
        if (data.greeting) setGeneratedGreeting(data.greeting);
        if (data.exampleDialogues) setCharacterExampleDialogues(data.exampleDialogues);
        if (data.systemPrompt) setGeneratedSystemPrompt(data.systemPrompt);
      } else if (sectionId === 'character_assets') {
        if (data.worldNotes) setCharacterWorldNotes(data.worldNotes);
        if (data.skillCards) setCharacterSkillCards(data.skillCards);
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      alert(error.message || '生成失败，请重试');
    } finally {
      setGeneratingSection(null);
    }
  };

  const handleBlueprintCheck = async () => {
    if (!blueprint || checkingBlueprint) return;
    setCheckingBlueprint(true);

    try {
      const response = await fetch('/api/create/blueprint-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ blueprint, repair: true }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Blueprint check failed');
      }

      const result = await response.json();
      setBlueprint(result.blueprint);
      setBlueprintView('diagnostics');
    } catch (error: any) {
      console.error('Blueprint check error:', error);
      alert(error.message || '骨架检查失败，请重试');
    } finally {
      setCheckingBlueprint(false);
    }
  };

  // Submit the agent
  const handleSubmit = async () => {
    if (!canCreate || submitting) return;

    setSubmitting(true);
    try {
      const builderConfig = creationType === 'mystery' ? {
        type: 'mystery',
        concept,
        suspects,
        coreTrick,
        clues,
        redHerrings,
        truth,
        solutionCondition,
        endings,
        openingScene,
        crimeScene,
        greeting: generatedGreeting,
        systemPrompt: generatedSystemPrompt,
        blueprint,
      } : creationType === 'character' ? {
        type: 'character',
        characterConcept,
        identity: characterIdentity,
        personality: characterPersonality,
        speakingStyle: characterSpeakingStyle,
        scenario: characterScenario,
        relationshipToPlayer: characterRelationship,
        boundaries: characterBoundaries,
        exampleDialogues: characterExampleDialogues,
        worldNotes: characterWorldNotes,
        skillCards: characterSkillCards,
        greeting: generatedGreeting,
        systemPrompt: generatedSystemPrompt,
      } : undefined;

      const payload = {
        name,
        description,
        category,
        tone,
        greeting: finalGreeting,
        systemPrompt: finalPrompt,
        avatar: selectedAvatar,
        isPublic,
        creationType,
        builderConfig,
        hook: description,
        openingScene: openingScene || undefined,
        playerRole: undefined,
        rules: undefined,
        winConditions: solutionCondition || undefined,
      };

      if (editingAgentId) {
        await agents.update(editingAgentId, payload);
      } else {
        await agents.create(payload);
      }
      router.push('/me');
    } catch (error) {
      console.error('Save agent failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (needsLogin === null || loadingAgent) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-white/40" size={24} />
        </div>
      </AppShell>
    );
  }

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired
            title="登录后创作你的世界"
            description="创作世界会保存头像、设定、开场白和发布状态。登录后可以在我的空间继续维护。"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="py-8">
        {/* Header */}
        <section className="mb-8 rounded-[32px] border border-white/10 bg-[#19172a] p-6 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
                <Wand2 size={16} className="text-[#d89022]" />
                {editingAgentId ? '体验编辑器' : '体验创作器'}
              </div>
              <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
                {editingAgentId ? '继续打磨你的体验。' : '创造一个可玩的故事体验。'}
              </h1>
              <p className="mt-4 text-base leading-7 text-white/58">
                {editingAgentId
                  ? '修改设定、内容和开场白。保存后会更新你的体验。'
                  : '选择类型，填写内容。每个部分都可以手动填写或让 AI 提供建议。'}
              </p>
            </div>
            {creationType && (
              <button
                onClick={() => setCreationType(null)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/[0.12]"
              >
                <RefreshCw size={14} />
                重新选择类型
              </button>
            )}
          </div>
        </section>

        {/* Type Selection */}
        {!creationType && (
          <section className="mb-8">
            <h2 className="mb-6 text-2xl font-black text-white">选择创作类型</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CREATION_TYPES.map((type) => (
                <button
                  key={type.id}
                  disabled={type.id !== 'mystery' && type.id !== 'character'}
                  onClick={() => {
                    if (type.id !== 'mystery' && type.id !== 'character') return;
                    setCreationType(type.id);
                    if (type.id === 'mystery') setCategory('悬疑推理');
                    if (type.id === 'character') {
                      setCategory('角色扮演');
                      setTone('沉浸');
                      setSelectedAvatar('🎭');
                    }
                  }}
                  className={cn(
                    'group rounded-[28px] border border-white/10 bg-[#242039] p-6 text-left transition',
                    type.id === 'mystery' || type.id === 'character'
                      ? 'hover:-translate-y-1 hover:border-white/20 hover:shadow-xl'
                      : 'cursor-not-allowed opacity-45'
                  )}
                >
                  <div
                    className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
                    style={{ backgroundColor: `${type.color}20` }}
                  >
                    {type.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-black text-white">{type.name}</h3>
                  <p className="text-sm leading-6 text-white/54">{type.description}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white/40 transition group-hover:text-white/70">
                    {type.id === 'mystery' || type.id === 'character' ? '开始创作' : '即将开放'}
                    <ChevronRight size={14} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Mystery Case Builder - Horizontal Tabs */}
        {creationType === 'mystery' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              {/* AI Skeleton */}
              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-[#d89022]">AI 案件骨架</p>
                    <h2 className="mt-1 text-2xl font-black text-white">先用一句话搭出推理案件</h2>
                    <p className="mt-2 text-sm leading-6 text-white/54">
                      输入一个案件灵感，AI 会先生成嫌疑人和核心诡计，后面再逐步补线索、真相和开场。
                    </p>
                  </div>
                  <div className="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/54">
                    {completedSections}/4
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    value={concept}
                    onChange={(event) => setConcept(event.target.value)}
                    placeholder="例如：暴风雪山庄里，一封遗书在众目睽睽下消失。"
                    className="h-12 rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                  />
                  <button
                    onClick={() => handleGenerate('concept')}
                    disabled={generatingSection === 'concept'}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5 disabled:bg-white/[0.08] disabled:text-white/30"
                  >
                    {generatingSection === 'concept' ? <LoadingSpinner size="sm" /> : <Sparkles size={16} />}
                    生成案件骨架
                  </button>
                </div>
              </section>

              {/* Tab Bar */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {MYSTERY_SECTIONS.map((section) => {
                  const isActive = activeTab === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveTab(section.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap transition',
                        isActive
                          ? 'bg-white text-[#19172a] shadow-sm'
                          : 'bg-white/[0.08] text-white/54 hover:bg-white/[0.12]'
                      )}
                    >
                      <span style={{ color: isActive ? section.color : undefined }}>{section.icon}</span>
                      {section.title}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: `${MYSTERY_SECTIONS.find((s) => s.id === activeTab)?.color}20`, color: MYSTERY_SECTIONS.find((s) => s.id === activeTab)?.color }}
                    >
                      {MYSTERY_SECTIONS.find((s) => s.id === activeTab)?.icon}
                    </div>
                    <h2 className="text-xl font-black text-white">
                      {MYSTERY_SECTIONS.find((s) => s.id === activeTab)?.title}
                    </h2>
                  </div>
                  <button
                    onClick={() => handleGenerate(activeTab)}
                    disabled={generatingSection === activeTab || !canGenerateSection(activeTab)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition',
                      generatingSection === activeTab || !canGenerateSection(activeTab)
                        ? 'bg-white/[0.08] text-white/30'
                        : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
                    )}
                  >
                    {generatingSection === activeTab ? (
                      <>
                        <LoadingSpinner size="sm" />
                        生成中
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        AI 建议
                      </>
                    )}
                  </button>
                </div>

                {/* Tab: Suspects */}
                {activeTab === 'concept' && (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-white/70">嫌疑人</span>
                        <button
                          onClick={() => setSuspects([...suspects, { name: '', role: '', motive: '', secret: '' }])}
                          className="text-xs font-bold text-white/40 hover:text-white/64"
                        >
                          + 添加嫌疑人
                        </button>
                      </div>
                      {suspects.map((suspect, index) => (
                        <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input
                              value={suspect.name}
                              onChange={(e) => {
                                const updated = [...suspects];
                                updated[index].name = e.target.value;
                                setSuspects(updated);
                              }}
                              placeholder="姓名"
                              className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                            />
                            <input
                              value={suspect.role}
                              onChange={(e) => {
                                const updated = [...suspects];
                                updated[index].role = e.target.value;
                                setSuspects(updated);
                              }}
                              placeholder="身份"
                              className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                            />
                          </div>
                          <input
                            value={suspect.motive}
                            onChange={(e) => {
                              const updated = [...suspects];
                              updated[index].motive = e.target.value;
                              setSuspects(updated);
                            }}
                            placeholder="动机"
                            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <input
                            value={suspect.secret}
                            onChange={(e) => {
                              const updated = [...suspects];
                              updated[index].secret = e.target.value;
                              setSuspects(updated);
                            }}
                            placeholder="秘密"
                            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <button
                            onClick={() => setSuspects(suspects.filter((_, i) => i !== index))}
                            className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">核心诡计</span>
                      <textarea
                        value={coreTrick}
                        onChange={(e) => setCoreTrick(e.target.value)}
                        placeholder="案件的核心手法或谜题"
                        rows={2}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>
                  </div>
                )}

                {/* Tab: Clues */}
                {activeTab === 'clues' && (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-white/70">线索</span>
                        <button
                          onClick={() => setClues([...clues, { name: '', description: '', visibility: 'public' }])}
                          className="text-xs font-bold text-white/40 hover:text-white/64"
                        >
                          + 添加线索
                        </button>
                      </div>
                      {clues.map((clue, index) => (
                        <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                          <div className="flex items-center gap-3">
                            <input
                              value={clue.name}
                              onChange={(e) => {
                                const updated = [...clues];
                                updated[index].name = e.target.value;
                                setClues(updated);
                              }}
                              placeholder="线索名称"
                              className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                            />
                            <select
                              value={clue.visibility}
                              onChange={(e) => {
                                const updated = [...clues];
                                updated[index].visibility = e.target.value;
                                setClues(updated);
                              }}
                              className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none"
                            >
                              <option value="public">公开</option>
                              <option value="hidden">隐藏</option>
                            </select>
                          </div>
                          <textarea
                            value={clue.description}
                            onChange={(e) => {
                              const updated = [...clues];
                              updated[index].description = e.target.value;
                              setClues(updated);
                            }}
                            placeholder="线索描述"
                            rows={2}
                            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <button
                            onClick={() => setClues(clues.filter((_, i) => i !== index))}
                            className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-white/70">干扰项</span>
                        <button
                          onClick={() => setRedHerrings([...redHerrings, { name: '', description: '' }])}
                          className="text-xs font-bold text-white/40 hover:text-white/64"
                        >
                          + 添加干扰项
                        </button>
                      </div>
                      {redHerrings.map((item, index) => (
                        <div key={index} className="mb-3 rounded-2xl bg-rose-500/10 p-4">
                          <input
                            value={item.name}
                            onChange={(e) => {
                              const updated = [...redHerrings];
                              updated[index].name = e.target.value;
                              setRedHerrings(updated);
                            }}
                            placeholder="干扰项名称"
                            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <textarea
                            value={item.description}
                            onChange={(e) => {
                              const updated = [...redHerrings];
                              updated[index].description = e.target.value;
                              setRedHerrings(updated);
                            }}
                            placeholder="描述"
                            rows={2}
                            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <button
                            onClick={() => setRedHerrings(redHerrings.filter((_, i) => i !== index))}
                            className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab: Truth */}
                {activeTab === 'truth' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-white/[0.06] p-4">
                      <span className="text-sm font-bold text-white/70">真相</span>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input
                          value={truth?.killer || ''}
                          onChange={(e) => setTruth({ ...truth, killer: e.target.value })}
                          placeholder="凶手"
                          className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <input
                          value={truth?.method || ''}
                          onChange={(e) => setTruth({ ...truth, method: e.target.value })}
                          placeholder="作案手法"
                          className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                      </div>
                      <textarea
                        value={truth?.narrative || ''}
                        onChange={(e) => setTruth({ ...truth, narrative: e.target.value })}
                        placeholder="真相叙述"
                        rows={3}
                        className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">破案条件</span>
                      <textarea
                        value={solutionCondition}
                        onChange={(e) => setSolutionCondition(e.target.value)}
                        placeholder="玩家需要满足什么条件才能破案"
                        rows={2}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-white/70">结局</span>
                        <button
                          onClick={() => setEndings([...endings, { id: `ending_${endings.length}`, name: '', condition: '', description: '' }])}
                          className="text-xs font-bold text-white/40 hover:text-white/64"
                        >
                          + 添加结局
                        </button>
                      </div>
                      {endings.map((ending, index) => (
                        <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                          <input
                            value={ending.name}
                            onChange={(e) => {
                              const updated = [...endings];
                              updated[index].name = e.target.value;
                              setEndings(updated);
                            }}
                            placeholder="结局名称"
                            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <input
                            value={ending.condition}
                            onChange={(e) => {
                              const updated = [...endings];
                              updated[index].condition = e.target.value;
                              setEndings(updated);
                            }}
                            placeholder="触发条件"
                            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <textarea
                            value={ending.description}
                            onChange={(e) => {
                              const updated = [...endings];
                              updated[index].description = e.target.value;
                              setEndings(updated);
                            }}
                            placeholder="结局描述"
                            rows={2}
                            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <button
                            onClick={() => setEndings(endings.filter((_, i) => i !== index))}
                            className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab: Opening */}
                {activeTab === 'opening' && (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">开场场景</span>
                      <textarea
                        value={openingScene}
                        onChange={(e) => setOpeningScene(e.target.value)}
                        placeholder="描述玩家进入故事时看到的场景"
                        rows={4}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">案发现场</span>
                      <textarea
                        value={crimeScene}
                        onChange={(e) => setCrimeScene(e.target.value)}
                        placeholder="描述案件发生的具体地点"
                        rows={3}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">欢迎消息</span>
                      <textarea
                        value={generatedGreeting}
                        onChange={(e) => setGeneratedGreeting(e.target.value)}
                        placeholder="玩家看到的第一条消息"
                        rows={2}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">系统提示词</span>
                      <textarea
                        value={generatedSystemPrompt}
                        onChange={(e) => setGeneratedSystemPrompt(e.target.value)}
                        placeholder="运行时使用的系统提示词"
                        rows={6}
                        className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 font-mono text-sm leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    </label>
                  </div>
                )}

                {/* Tab: Blueprint */}
                {activeTab === 'blueprint' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-white/[0.06] p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-white/70">Engine blueprint</span>
                        <span className="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-bold text-white/40">
                          v{blueprint?.blueprintVersion || 1}
                        </span>
                      </div>
                      {blueprint ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                            <div className="text-xs font-bold text-white/40">Scenes</div>
                            <div className="mt-1 text-lg font-black text-white">{blueprint.scenes?.length || 0}</div>
                          </div>
                          <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                            <div className="text-xs font-bold text-white/40">Objects</div>
                            <div className="mt-1 text-lg font-black text-white">{blueprint.objects?.length || 0}</div>
                          </div>
                          <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                            <div className="text-xs font-bold text-white/40">Actions</div>
                            <div className="mt-1 text-lg font-black text-white">{blueprint.actions?.length || 0}</div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-white/54">
                          Generate this after suspects, clues, truth, endings, and opening are ready.
                        </p>
                      )}
                    </div>

                    {blueprint && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {[
                          { id: 'overview', label: '总览' },
                          { id: 'evidence', label: '证据链' },
                          { id: 'diagnostics', label: '检查' },
                          { id: 'json', label: '高级编辑' },
                        ].map((view) => (
                          <button
                            key={view.id}
                            type="button"
                            onClick={() => setBlueprintView(view.id as typeof blueprintView)}
                            className={cn(
                              'rounded-full px-3 py-1.5 text-xs font-bold transition',
                              blueprintView === view.id
                                ? 'bg-white text-[#19172a]'
                                : 'bg-white/[0.08] text-white/54 hover:bg-white/[0.12]'
                            )}
                          >
                            {view.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {blueprint && (
                      <div className="rounded-2xl bg-white/[0.06] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-black text-white/78">骨架维护</div>
                            <div className="mt-1 text-xs text-white/40">不调用 AI，只重新运行修复、证据链补齐和引擎试跑。</div>
                          </div>
                          <button
                            type="button"
                            onClick={handleBlueprintCheck}
                            disabled={checkingBlueprint}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg disabled:bg-white/[0.08] disabled:text-white/30"
                          >
                            {checkingBlueprint ? <LoadingSpinner size="sm" /> : <Workflow size={16} />}
                            检查/修复
                          </button>
                        </div>
                      </div>
                    )}

                    {blueprint && blueprintView === 'overview' && (
                      <div className="rounded-2xl bg-white/[0.06] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-black text-white/78">关系图</div>
                            <div className="mt-1 text-xs text-white/40">用弹框查看可拖拽、缩放和平移的骨架图。</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBlueprintGraphOpen(true)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg"
                          >
                            <Workflow size={16} />
                            查看关系图
                          </button>
                        </div>
                      </div>
                    )}

                    {blueprint && blueprintView === 'evidence' && (
                      <div className="space-y-3">
                        {(blueprint.evidenceChain || []).length > 0 ? (
                          (blueprint.evidenceChain || []).map((evidence: any) => (
                            <div key={evidence.id} className="rounded-2xl bg-white/[0.06] p-4">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="text-sm font-black text-white">{evidence.title || evidence.id}</div>
                                  <div className="mt-1 text-xs text-white/40">
                                    clue: {evidence.clueId || '-'} · action: {evidence.obtainedByActionId || '-'}
                                  </div>
                                </div>
                                <span
                                  className={cn(
                                    'w-fit rounded-full px-3 py-1 text-xs font-bold',
                                    evidence.requiredForAccusation
                                      ? 'bg-emerald-500/15 text-emerald-200'
                                      : 'bg-white/[0.08] text-white/45'
                                  )}
                                >
                                  {evidence.requiredForAccusation ? '指认必需' : '辅助证据'}
                                </span>
                              </div>
                              {evidence.proves?.length > 0 && (
                                <ul className="mt-3 space-y-1 text-sm text-white/64">
                                  {evidence.proves.map((item: string, index: number) => (
                                    <li key={index}>- {item}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-white/[0.06] p-4 text-sm text-white/54">
                            暂无 evidenceChain。重新生成玩法骨架后，系统会自动补齐基础证据链。
                          </div>
                        )}
                      </div>
                    )}

                    {blueprint && blueprintView === 'diagnostics' && (
                      <div className="space-y-3">
                        {blueprint.dryRunReport && (
                          <div className="rounded-2xl bg-white/[0.06] p-4">
                            <div className="mb-3 text-sm font-black text-white">试跑报告</div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                                <div className="text-xs font-bold text-white/40">到达场景</div>
                                <div className="mt-1 text-lg font-black text-white">
                                  {blueprint.dryRunReport.reachedSceneIds?.length || 0}
                                </div>
                              </div>
                              <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                                <div className="text-xs font-bold text-white/40">触发动作</div>
                                <div className="mt-1 text-lg font-black text-white">
                                  {blueprint.dryRunReport.reachedActionIds?.length || 0}
                                </div>
                              </div>
                              <div className="rounded-xl bg-white/[0.08] px-3 py-2">
                                <div className="text-xs font-bold text-white/40">获得线索</div>
                                <div className="mt-1 text-lg font-black text-white">
                                  {blueprint.dryRunReport.reachedClueIds?.length || 0}
                                </div>
                              </div>
                            </div>
                            {blueprint.dryRunReport.missingRequiredEvidenceIds?.length > 0 && (
                              <div className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-100/80">
                                缺少必需证据：{blueprint.dryRunReport.missingRequiredEvidenceIds.join(', ')}
                              </div>
                            )}
                            {blueprint.dryRunReport.deadEnds?.length > 0 && (
                              <div className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-100/80">
                                发现死路：{blueprint.dryRunReport.deadEnds.length}
                              </div>
                            )}
                            {blueprint.dryRunReport.missingRequiredEvidence?.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {blueprint.dryRunReport.missingRequiredEvidence.map((item: any) => (
                                  <div key={item.evidenceId} className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-100/75">
                                    {item.evidenceId} · clue: {item.clueId || '-'} · action: {item.obtainedByActionId || '-'}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-white/42">
                              explored states: {blueprint.dryRunReport.exploredStateCount || 0}
                              {blueprint.dryRunReport.truncated ? ` / limit ${blueprint.dryRunReport.maxStates}` : ''}
                              {blueprint.dryRunReport.truncated && !blueprint.dryRunReport.missingRequiredEvidenceIds?.length
                                ? ' · required evidence covered'
                                : ''}
                            </div>
                          </div>
                        )}
                        <div className="rounded-2xl bg-white/[0.06] p-4">
                          <div className="text-sm font-black text-white">引擎检查</div>
                          {(blueprint.validationNotes || []).length > 0 ? (
                            <ul className="mt-3 space-y-2 text-sm text-amber-100/80">
                              {blueprint.validationNotes.map((note: string, index: number) => (
                                <li key={index}>- {note}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-emerald-200/80">当前没有发现结构问题。</p>
                          )}
                        </div>
                      </div>
                    )}

                    <BlueprintGraphDialog
                      blueprint={blueprint}
                      open={Boolean(blueprint && blueprintGraphOpen)}
                      onClose={() => setBlueprintGraphOpen(false)}
                    />

                    {blueprint && blueprintView === 'json' && (
                      <textarea
                        value={JSON.stringify(blueprint, null, 2)}
                        onChange={(event) => {
                          try {
                            setBlueprint(JSON.parse(event.target.value));
                          } catch {
                            // Keep editing forgiving; invalid JSON simply is not applied.
                          }
                        }}
                        rows={16}
                        className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 font-mono text-xs leading-5 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                      />
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* Preview Panel */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
                <div className="h-2 bg-[#6366f1]" />
                <div className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64">
                      <Eye size={14} />
                      创建检查
                    </div>
                    <button
                      onClick={() => setIsPublic(!isPublic)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
                        isPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.08] text-white/64'
                      )}
                    >
                      {isPublic ? <Check size={14} /> : <Lock size={14} />}
                      {isPublic ? '公开' : '私有'}
                    </button>
                  </div>

                  <div className="mb-4 rounded-[24px] bg-white/[0.06] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-black text-white">完成度</div>
                      <div className="text-xs font-bold text-white/40">{completedSections}/4</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {publishChecks.map((item) => (
                        <div
                          key={item.label}
                          className={cn(
                            'rounded-2xl px-3 py-2 text-xs font-bold',
                            item.done ? 'bg-emerald-500/14 text-emerald-300' : 'bg-white/[0.06] text-white/36'
                          )}
                        >
                          {item.done ? '已完成 ' : '待补充 '}
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] bg-white/[0.06] p-5">
                    <div className="mb-5 flex items-start gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-4xl">
                        {selectedAvatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-black text-white">{name || '未命名体验'}</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                            {category}
                          </span>
                          <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                            {tone}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="min-h-[48px] text-sm leading-6 text-white/64">
                      {description || '写一句话，吸引玩家进入这个体验。'}
                    </p>

                    {suspects.length > 0 && (
                      <div className="mt-4 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-2 text-xs font-bold text-white/40">嫌疑人 ({suspects.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {suspects.map((s, i) => (
                            <span key={i} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs text-white/64">
                              {s.name || '未命名'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {clues.length > 0 && (
                      <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-1 text-xs font-bold text-white/40">线索 ({clues.length})</div>
                      </div>
                    )}

                    {truth?.killer && (
                      <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-1 text-xs font-bold text-white/40">凶手</div>
                        <p className="text-sm text-white/70">{truth.killer}</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">名称</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="体验名称"
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">简介</span>
                      <input
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="一句话简介"
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </label>
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={!canCreate || submitting}
                    className={cn(
                      'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
                      canCreate && !submitting
                        ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                        : 'bg-white/[0.08] text-white/30'
                    )}
                  >
                    <Sparkles size={16} />
                    {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建体验'}
                  </button>
                  {!canCreate && creationType === 'mystery' && !mysteryReady && (
                    <p className="mt-2 text-center text-xs text-white/40">
                      请完成上方 4 项检查后再创建
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}

        {creationType === 'character' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-[#d89022]">角色卡</p>
                    <h2 className="mt-1 text-2xl font-black text-white">先用一句话搭出角色</h2>
                    <p className="mt-2 text-sm leading-6 text-white/54">
                      角色扮演 Agent 先维护角色资产：身份、性格、说话方式、当前情境和边界。
                    </p>
                  </div>
                  <div className="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/54">
                    角色扮演
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    value={characterConcept}
                    onChange={(event) => setCharacterConcept(event.target.value)}
                    placeholder="例如：一位住在旧书店里的温柔占卜师，知道很多不该知道的事。"
                    className="h-12 rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                  />
                  <button
                    onClick={() => handleGenerate('character_base')}
                    disabled={generatingSection === 'character_base'}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5 disabled:bg-white/[0.08] disabled:text-white/30"
                  >
                    {generatingSection === 'character_base' ? <LoadingSpinner size="sm" /> : <Sparkles size={16} />}
                    生成角色设定
                  </button>
                </div>
              </section>

              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8b5cf6]/20 text-[#c4b5fd]">
                      <Palette size={18} />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-white">角色资料</h2>
                      <p className="mt-1 text-xs text-white/40">这些内容会组成运行时系统提示词。</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleGenerate('character_details')}
                    disabled={generatingSection === 'character_details' || !canGenerateSection('character_details')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition',
                      generatingSection === 'character_details' || !canGenerateSection('character_details')
                        ? 'bg-white/[0.08] text-white/30'
                        : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
                    )}
                  >
                    {generatingSection === 'character_details' ? (
                      <>
                        <LoadingSpinner size="sm" />
                        生成中
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        补充细节
                      </>
                    )}
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">角色名</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="角色名"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">一句话简介</span>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="展示在卡片上的简介"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">身份背景</span>
                    <textarea
                      value={characterIdentity}
                      onChange={(event) => setCharacterIdentity(event.target.value)}
                      rows={5}
                      placeholder="角色的身份、经历、秘密或背景。"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">性格特征</span>
                    <textarea
                      value={characterPersonality}
                      onChange={(event) => setCharacterPersonality(event.target.value)}
                      rows={5}
                      placeholder="角色的性格、习惯、情绪底色。"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">说话方式</span>
                    <textarea
                      value={characterSpeakingStyle}
                      onChange={(event) => setCharacterSpeakingStyle(event.target.value)}
                      rows={4}
                      placeholder="语气、口头禅、句式、称呼玩家的方式。"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">当前情境</span>
                    <textarea
                      value={characterScenario}
                      onChange={(event) => setCharacterScenario(event.target.value)}
                      rows={4}
                      placeholder="玩家第一次见到角色时，正在发生什么。"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">与玩家的关系</span>
                    <textarea
                      value={characterRelationship}
                      onChange={(event) => setCharacterRelationship(event.target.value)}
                      rows={3}
                      placeholder="例如：旧友、雇主、同行、第一次见面的陌生人。"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">角色边界</span>
                    <textarea
                      value={characterBoundaries.join('\n')}
                      onChange={(event) =>
                        setCharacterBoundaries(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))
                      }
                      rows={3}
                      placeholder={'每行一条，例如：\n不替玩家行动\n不跳出角色解释设定'}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#06b6d4]/20 text-[#67e8f9]">
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-white">世界资料</h2>
                      <p className="mt-1 text-xs text-white/40">角色稳定知道的事实。每行一条，会写入运行提示词。</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGenerate('character_assets')}
                    disabled={generatingSection === 'character_assets' || !canGenerateSection('character_assets')}
                    className={cn(
                      'inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-xs font-bold transition',
                      generatingSection === 'character_assets' || !canGenerateSection('character_assets')
                        ? 'bg-white/[0.08] text-white/30'
                        : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
                    )}
                  >
                    {generatingSection === 'character_assets' ? <LoadingSpinner size="sm" /> : <Sparkles size={14} />}
                    AI 生成玩法资产
                  </button>
                </div>
                <textarea
                  value={characterWorldNotes.join('\n')}
                  onChange={(event) =>
                    setCharacterWorldNotes(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))
                  }
                  rows={6}
                  placeholder={'例如：\n旧书店位于雾港东区，只在雨夜后半夜营业\n角色认识失踪的钟表匠，但不愿主动提起\n银色书签是识别老顾客的暗号'}
                  className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
              </section>

              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#10b981]/20 text-[#6ee7b7]">
                      <Wand2 size={18} />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-white">技能卡</h2>
                      <p className="mt-1 text-xs text-white/40">无代码技能，不执行插件，只指导角色在特定互动中怎么做。</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGenerate('character_assets')}
                    disabled={generatingSection === 'character_assets' || !canGenerateSection('character_assets')}
                    className={cn(
                      'inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-xs font-bold transition',
                      generatingSection === 'character_assets' || !canGenerateSection('character_assets')
                        ? 'bg-white/[0.08] text-white/30'
                        : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
                    )}
                  >
                    {generatingSection === 'character_assets' ? <LoadingSpinner size="sm" /> : <Sparkles size={14} />}
                    AI 生成技能
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCharacterSkillCards([
                        ...characterSkillCards,
                        { name: '', trigger: '', instruction: '', boundaries: '', example: '' },
                      ])
                    }
                    className="inline-flex h-9 items-center justify-center rounded-full bg-white/[0.08] px-4 text-xs font-bold text-white/64 transition hover:bg-white/[0.12]"
                  >
                    + 添加技能
                  </button>
                </div>

                {characterSkillCards.length === 0 ? (
                  <div className="rounded-2xl bg-white/[0.06] p-4 text-sm leading-6 text-white/45">
                    暂无技能卡。可以添加“占卜”“案件分析”“掷骰判定”“情绪安抚”等角色专属玩法。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {characterSkillCards.map((skill, index) => (
                      <div key={index} className="rounded-2xl bg-white/[0.06] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <input
                            value={skill.name}
                            onChange={(event) => {
                              const updated = [...characterSkillCards];
                              updated[index] = { ...updated[index], name: event.target.value };
                              setCharacterSkillCards(updated);
                            }}
                            placeholder="技能名，例如：塔罗占卜"
                            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <button
                            type="button"
                            onClick={() => setCharacterSkillCards(characterSkillCards.filter((_, itemIndex) => itemIndex !== index))}
                            className="text-xs font-bold text-rose-400 hover:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <textarea
                            value={skill.trigger}
                            onChange={(event) => {
                              const updated = [...characterSkillCards];
                              updated[index] = { ...updated[index], trigger: event.target.value };
                              setCharacterSkillCards(updated);
                            }}
                            rows={3}
                            placeholder="触发方式：用户什么时候会用到它"
                            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                          />
                          <textarea
                            value={skill.instruction}
                            onChange={(event) => {
                              const updated = [...characterSkillCards];
                              updated[index] = { ...updated[index], instruction: event.target.value };
                              setCharacterSkillCards(updated);
                            }}
                            rows={3}
                            placeholder="行为规则：角色应该怎样执行"
                            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                          />
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <textarea
                            value={skill.boundaries}
                            onChange={(event) => {
                              const updated = [...characterSkillCards];
                              updated[index] = { ...updated[index], boundaries: event.target.value };
                              setCharacterSkillCards(updated);
                            }}
                            rows={2}
                            placeholder="技能边界：不能做什么"
                            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                          />
                          <textarea
                            value={skill.example}
                            onChange={(event) => {
                              const updated = [...characterSkillCards];
                              updated[index] = { ...updated[index], example: event.target.value };
                              setCharacterSkillCards(updated);
                            }}
                            rows={2}
                            placeholder="示例回复"
                            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {(generatedGreeting || generatedSystemPrompt || characterExampleDialogues.length > 0) && (
                <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                  <h2 className="text-xl font-black text-white">生成结果</h2>
                  {generatedGreeting && (
                    <div className="mt-4 rounded-2xl bg-white/[0.06] p-4">
                      <div className="mb-2 text-xs font-bold text-white/40">开场白</div>
                      <p className="text-sm leading-6 text-white/70">{generatedGreeting}</p>
                    </div>
                  )}
                  {characterExampleDialogues.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {characterExampleDialogues.map((dialogue, index) => (
                        <div key={index} className="rounded-2xl bg-white/[0.06] p-4 text-sm leading-6">
                          <div className="text-white/48">玩家：{dialogue.player}</div>
                          <div className="mt-1 text-white/74">{name || '角色'}：{dialogue.character}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-white">运行提示词</h2>
                    <p className="mt-1 text-xs text-white/40">
                      最终会注入给模型的角色规则。留空时会根据上面的角色卡自动生成。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSystemPrompt(finalPrompt)}
                    className="inline-flex h-9 items-center justify-center rounded-full bg-white/[0.08] px-4 text-xs font-bold text-white/64 transition hover:bg-white/[0.12]"
                  >
                    使用自动提示词
                  </button>
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder={finalPrompt}
                  rows={10}
                  className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 font-mono text-xs leading-5 text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
              </section>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
                <div className="h-2 bg-[#8b5cf6]" />
                <div className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64">
                      <Eye size={14} />
                      角色预览
                    </div>
                    <button
                      onClick={() => setIsPublic(!isPublic)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
                        isPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.08] text-white/64'
                      )}
                    >
                      {isPublic ? <Check size={14} /> : <Lock size={14} />}
                      {isPublic ? '公开' : '私有'}
                    </button>
                  </div>

                  <div className="rounded-[28px] bg-white/[0.06] p-5">
                    <div className="mb-5 flex items-start gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-4xl">
                        {selectedAvatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-black text-white">{name || '未命名角色'}</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#8b5cf6] px-2.5 py-1 text-xs font-bold text-white">
                            角色扮演
                          </span>
                          <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                            {tone}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="min-h-[48px] text-sm leading-6 text-white/64">
                      {description || characterIdentity || '填写角色简介后，这里会展示给玩家。'}
                    </p>
                    {characterSpeakingStyle && (
                      <div className="mt-4 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-1 text-xs font-bold text-white/40">说话方式</div>
                        <p className="text-sm leading-6 text-white/68">{characterSpeakingStyle}</p>
                      </div>
                    )}
                    {(characterWorldNotes.length > 0 || characterSkillCards.length > 0) && (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-2xl bg-white/[0.08] px-3 py-2">
                          <div className="text-xs font-bold text-white/40">世界资料</div>
                          <div className="mt-1 text-lg font-black text-white">{characterWorldNotes.length}</div>
                        </div>
                        <div className="rounded-2xl bg-white/[0.08] px-3 py-2">
                          <div className="text-xs font-bold text-white/40">技能卡</div>
                          <div className="mt-1 text-lg font-black text-white">{characterSkillCards.length}</div>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 rounded-2xl bg-white/[0.08] p-4">
                      <div className="mb-1 text-xs font-bold text-white/40">开场白</div>
                      <p className="text-sm leading-6 text-white/68">{finalGreeting}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-sm font-bold text-white/70">头像</div>
                    <div className="grid grid-cols-8 gap-2">
                      {AVATAR_OPTIONS.slice(0, 16).map((avatar) => (
                        <button
                          key={avatar}
                          onClick={() => setSelectedAvatar(avatar)}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-xl text-lg transition',
                            selectedAvatar === avatar ? 'bg-white text-[#19172a]' : 'bg-white/[0.08] hover:bg-white/[0.12]'
                          )}
                        >
                          {avatar}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={!canCreate || submitting}
                    className={cn(
                      'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
                      canCreate && !submitting
                        ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                        : 'bg-white/[0.08] text-white/30'
                    )}
                  >
                    <Sparkles size={16} />
                    {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建角色'}
                  </button>
                  {!canCreate && (
                    <p className="mt-2 text-center text-xs text-white/40">
                      请至少填写名称、简介、身份、性格和说话方式
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Other creation types placeholder */}
        {creationType && creationType !== 'mystery' && creationType !== 'character' && (
          <div className="rounded-[32px] border border-dashed border-white/18 bg-white/[0.04] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-3xl">
              {CREATION_TYPES.find((t) => t.id === creationType)?.icon}
            </div>
            <h3 className="mb-2 text-xl font-black text-white">
              {CREATION_TYPES.find((t) => t.id === creationType)?.name} 创作器
            </h3>
            <p className="mb-6 text-sm text-white/54">
              此类型的创作器正在开发中。你可以使用基础字段手动创建。
            </p>
            <button
              onClick={() => setCreationType(null)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              返回选择
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function CreateAgentPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-white/40" size={24} />
          </div>
        </AppShell>
      }
    >
      <CreateAgentContent />
    </Suspense>
  );
}
