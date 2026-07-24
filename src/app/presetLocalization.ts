import type { PhaseFieldConfig } from '../simulation/types';
import { isJapanese } from './i18n';

type PresetCopy = {
  name: string;
  description: string;
};

const exactJapaneseCopy: Record<string, PresetCopy> = {
  '2d-isotropic': {
    name: '2D 等方核',
    description: '方向依存性を持たない基準となる放射状成長です。'
  },
  '2d-fourfold': {
    name: '2D 4回対称デンドライト',
    description: 'ブラウザで高速に試せる4回対称デンドライトです。'
  },
  '2d-sixfold': {
    name: '2D 6回対称・雪片状',
    description: '雪片状の定性的成長を調べる6回対称の異方性場です。'
  },
  '2d-sidebranch': {
    name: '2D 高ノイズ・サイドブランチ',
    description: 'サイドブランチのノイズ感度を調べる高ノイズ条件です。'
  },
  'paper-fig3-inward-walls': {
    name: 'K1993 Fig.3 壁面から内向き成長 K=1.0',
    description: '過冷却なしで、冷却された全壁面から結晶が内向きに成長する論文条件です。'
  },
  'paper-fig4-planar-k100': {
    name: 'K1993 Fig.4 左壁冷却プラナー成長 K=1.0',
    description: '左の冷却壁から成長し、初期の変形界面が平坦化するプラナーフロント検証です。'
  },
  'paper-fig5-k080-planar': {
    name: 'K1993 Fig.5 K=0.8 安定平面',
    description: '平坦界面が安定に保たれる方向凝固条件です。'
  },
  'paper-fig5-k090-slight': {
    name: 'K1993 Fig.5 K=0.9 弱い不安定化',
    description: '平坦界面がわずかに不安定化する方向凝固条件です。'
  },
  'paper-fig5-k100-cellular': {
    name: 'K1993 Fig.5 K=1.0 弱いセル状成長',
    description: '弱いセル状不安定性が現れる方向凝固条件です。'
  },
  'paper-fig5-k110-cellular-slits': {
    name: 'K1993 Fig.5 K=1.1 セル状スリット',
    description: '前進界面の後方にセル状のスリットが残る条件です。'
  },
  'paper-fig5-k120-splitting': {
    name: 'K1993 Fig.5 K=1.2 先端分裂',
    description: '先端分裂が生じる方向凝固条件です。'
  },
  'paper-fig5-k140-splitting': {
    name: 'K1993 Fig.5 K=1.4 強い先端分裂',
    description: 'より強い先端分裂と枝の競合が現れる条件です。'
  },
  'paper-fig5-k160-competition': {
    name: 'K1993 Fig.5 K=1.6 枝の競合',
    description: '枝どうしが遮蔽し合う方向凝固条件です。'
  },
  'paper-fig5-k180-spreading': {
    name: 'K1993 Fig.5 K=1.8 広がる枝',
    description: '成長後期に枝が広がる方向凝固条件です。'
  },
  'paper-fig5-k200-slow': {
    name: 'K1993 Fig.5 K=2.0 遅い後期成長',
    description: '部分凝固後の界面運動が遅くなる条件です。'
  },
  'paper-fig6-k080-anisotropic': {
    name: 'K1993 Fig.6 K=0.8 異方性・安定平面',
    description: '4回対称異方性を持ちながら平坦界面が安定な条件です。'
  },
  'paper-fig6-k090-anisotropic': {
    name: 'K1993 Fig.6 K=0.9 異方性・弱いセル状成長',
    description: '4回対称異方性の下で弱いセル状構造が現れる条件です。'
  },
  'paper-fig6-k100-anisotropic': {
    name: 'K1993 Fig.6 K=1.0 異方性・弱いセル状成長',
    description: '4回対称異方性の下で弱いセル状構造が現れる条件です。'
  },
  'paper-fig6-k110-anisotropic': {
    name: 'K1993 Fig.6 K=1.1 異方性スリット',
    description: '前進界面の後方に異方性スリットが残る条件です。'
  },
  'paper-fig6-k120-anisotropic': {
    name: 'K1993 Fig.6 K=1.2 異方性スリット',
    description: 'スリット状の枝が競合する4回対称条件です。'
  },
  'paper-fig6-k140-anisotropic': {
    name: 'K1993 Fig.6 K=1.4 長い異方性スリット',
    description: '異方性方向へ長いスリット状の枝が伸びる条件です。'
  },
  'paper-fig6-k160-anisotropic': {
    name: 'K1993 Fig.6 K=1.6 異方性枝の競合',
    description: '等方条件とは異なる枝の競合が現れる4回対称条件です。'
  },
  'paper-fig6-k180-anisotropic': {
    name: 'K1993 Fig.6 K=1.8 異方性サイドブランチ',
    description: '速い主枝にサイドブランチが現れる条件です。'
  },
  'paper-fig6-k200-anisotropic': {
    name: 'K1993 Fig.6 K=2.0 長い異方性枝',
    description: '異方性の優先方向へ長い枝が成長する条件です。'
  },
  'paper-fig7-delta000': {
    name: 'K1993 Fig.7 δ=0.000 a=0.010 等方条件',
    description: 'Fig.7(1)に対応する底辺中央核・等方成長条件です。'
  },
  'paper-fig7-delta005': {
    name: 'K1993 Fig.7 δ=0.005 a=0.010 ごく弱い4回対称',
    description: '等方的な指状成長と鉛直デンドライトが混在する、ごく弱い4回対称条件です。'
  },
  'paper-fig7-delta010': {
    name: 'K1993 Fig.7 δ=0.010 a=0.010 4回対称',
    description: '典型的なデンドライトのサイドブランチを示す弱い4回対称条件です。'
  },
  'paper-fig7-delta020': {
    name: 'K1993 Fig.7 δ=0.020 a=0.010 強い4回対称',
    description: '枝が異方性方向へ近づく、より強い4回対称条件です。'
  },
  'paper-fig7-delta050': {
    name: 'K1993 Fig.7 δ=0.050 a=0.010 非常に強い4回対称',
    description: '枝の競合と遮蔽を調べる強い4回対称異方性条件です。'
  },
  'paper-fig8-k080-sixfold': {
    name: 'K1993 Fig.8 K=0.8 6回対称・凸六角形',
    description: '厳密に凸な六角形結晶となる低潜熱条件です。'
  },
  'paper-fig8-k100-sixfold': {
    name: 'K1993 Fig.8 K=1.0 6回対称・辺中央のくぼみ',
    description: '結晶の各辺中央にくぼみが現れる6回対称条件です。'
  },
  'paper-fig8-k120-sixfold': {
    name: 'K1993 Fig.8 K=1.2 6回対称',
    description: '六角形から分岐構造へ移行する中間潜熱条件です。'
  },
  'paper-fig8-k160-sixfold': {
    name: 'K1993 Fig.8 K=1.6 6回対称・分岐',
    description: '明瞭な分岐パターンを示す6回対称条件です。'
  },
  'paper-fig8-k200-sixfold': {
    name: 'K1993 Fig.8 K=2.0 雪片状',
    description: '過冷却融液からの雪片状成長です。気相からの雪結晶モデルではありません。'
  },
  'paper-fig9-noise010': {
    name: 'K1993 Fig.9 a=0.010 ノイズ大',
    description: '先端振動を伴わないデンドライトの高ノイズ比較条件です。'
  },
  'paper-fig9-noise001': {
    name: 'K1993 Fig.9 a=0.001 ノイズ小',
    description: '先端振動を伴わないデンドライトの弱ノイズ比較条件です。'
  },
  'paper-fig9-no-noise': {
    name: 'K1993 Fig.9 a=0 ノイズなし',
    description: '先端振動を伴わないデンドライトの無ノイズ比較条件です。'
  },
  'paper-fig9-3d-left-target': {
    name: 'K2002 Fig.9 左・3D再現条件',
    description: '底面中央の滑らかなr=7核から成長する、全領域の等方3D再現条件です。'
  },
  'paper-fig9-3d-right-target': {
    name: 'K2002 Fig.9 右・3D推定条件',
    description: 'x/y対称性を使う1/4領域と滑らかなr=7角核による3D推定条件です。'
  },
  'paper-fig10-no-noise': {
    name: 'K1993 Fig.10 a=0 ノイズなし',
    description: '先端振動を伴う条件で、確率ノイズなしのサイドブランチを比較します。'
  },
  'paper-fig10-noise001': {
    name: 'K1993 Fig.10 a=0.001 ノイズ小',
    description: '先端振動を伴う条件で、弱いノイズによる枝構造を比較します。'
  },
  'paper-fig10-noise010': {
    name: 'K1993 Fig.10 a=0.010 ノイズ大',
    description: '先端振動を伴う条件で、強いノイズによる枝構造を比較します。'
  },
  '3d-isotropic': {
    name: '3D 等方核',
    description: '方向依存性を持たない3Dの基準成長です。'
  },
  '3d-cubic': {
    name: '3D 立方対称デンドライト',
    description: '立方対称異方性を持つ定性的な3Dデンドライトです。'
  },
  '3d-cubic-100': {
    name: '3D 立方対称・高解像度100³',
    description: '100³メッシュの高解像度3D探索条件です。'
  },
  '3d-cubic-128': {
    name: '3D 立方対称・低速高解像度128³',
    description: '128³メッシュの低速な高解像度3D探索条件です。'
  }
};

export function localizedPresetName(config: PhaseFieldConfig): string {
  if (!isJapanese()) return config.name;
  return exactJapaneseCopy[config.id]?.name ?? config.name;
}

export function localizedPresetDescription(config: PhaseFieldConfig): string {
  if (!isJapanese()) return config.description ?? '';
  return exactJapaneseCopy[config.id]?.description ?? config.description ?? '';
}

export function localizedPaperDetails(config: PhaseFieldConfig): string[] {
  const sourceDetails = config.paperReference?.details ?? [];
  if (!isJapanese() || sourceDetails.length === 0) return sourceDetails;

  if (config.id === 'paper-fig3-inward-walls') {
    return [
      '過冷却なしの等方条件で、K = 1.0。',
      '容器の全周壁面を冷却するため、固相は全壁面から内向きに成長する。',
      '界面は内側へ進むにつれて丸くなり、最終的に消滅する。'
    ];
  }
  if (config.id === 'paper-fig4-planar-k100') {
    return [
      '過冷却なしの等方条件で、K = 1.0。',
      '左壁のみを冷却し、その他の壁では熱流束を0とする。',
      '初期に変形させた界面は短時間で平坦化する。'
    ];
  }
  if (config.id === 'paper-fig9-3d-left-target') {
    return [
      'K2002 Fig.9左とシミュレーション結果の比較から選んだ再現候補。',
      'K = 2.5, delta = 0, a = 0.01, r = 7セル、目標時刻 t = 0.4。',
      '全領域メッシュは160 x 160 x 100、dx = dy = dz = 0.03、領域寸法は4.8 x 4.8 x 3.0。',
      '初期核はx-y底面中央に置き、中心を下側zノイマン面の外へ半セルずらした滑らかな球とする。',
      'この条件は公開された厳密値ではなく、図との定性的比較で選んだ再現値である。'
    ];
  }
  if (config.id === 'paper-fig9-3d-right-target') {
    return [
      '3Dの厳密な数値条件が得られなかったため、図との比較から選んだ定性的推定条件。',
      'K = 3.5, delta = 0.020, a = 0.005, r = 7セル、目標時刻 t ~= 0.9。',
      '1/4領域メッシュは50 x 50 x 200、dx = dy = dz = 0.03、領域寸法は1.5 x 1.5 x 6.0。',
      '表示とSTLではx-yを反転し、100 x 100 x 200、3.0 x 3.0 x 6.0の全領域として示す。',
      '初期核はx、y、zのノイマン面の外へ半セルずらした滑らかな角核である。',
      '3D異方性にはK2002の成分表示を使い、式は「モデルと手法」に記載する。'
    ];
  }

  const details = [
    `K = ${formatNumber(config.latentHeat)}, delta = ${formatNumber(config.anisotropyStrength)}, j = ${config.anisotropyFold}, theta0 = ${formatNumber(config.anisotropyAngle)}。`,
    localizedPresetDescription(config)
  ];
  if (config.noiseAmplitude === 0) {
    details.push('界面ノイズなしの比較条件。');
  } else {
    details.push(`界面ノイズ振幅は a = ${formatNumber(config.noiseAmplitude)}。`);
  }
  return details;
}

function formatNumber(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) < 0.001) return value.toExponential(1);
  return Number(value.toPrecision(6)).toString();
}
