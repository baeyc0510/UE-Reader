// Hand-written sample explanations for the bundled demo workspace (samples/).
import { randomUUID } from 'node:crypto';
import { readSource } from '../source/source.mjs';

export const DEMO_FILE = 'Source/ReaderDemo/Private/ReadingActor.cpp';
const sections = [
  [7, 14, '생성자 · 기본 상태와 루트 컴포넌트', '이 예제의 생성자는 Tick 사용을 켜고, `USceneComponent`를 기본 서브오브젝트로 생성한 뒤 루트 컴포넌트로 지정합니다.\n\n`SceneRoot` 선언은 헤더에서 확인할 수 있습니다. 엔진 내부의 생성·등록 과정은 이 예제에 포함되어 있지 않습니다.'],
  [16, 27, 'BeginPlay · 준비 상태 설정', '`Super::BeginPlay()`를 먼저 호출합니다. 이후 `SceneRoot`가 유효하지 않으면 즉시 반환합니다. 유효한 경우에만 `bReady`를 `true`로 바꿉니다.\n\n이 상태는 아래 `Tick` 함수에서 회전 처리 여부를 결정합니다.'],
  [28, 42, 'Tick · 프레임 시간에 따른 회전', '`bReady`가 `false`이면 회전을 실행하지 않습니다. 준비된 상태에서는 회전 속도에 `DeltaSeconds`를 곱해 이번 프레임의 회전량을 구합니다.\n\n1. 부모의 `Tick`을 호출합니다.\n2. 준비 상태를 검사합니다.\n3. Yaw 회전량을 계산합니다.\n4. `AddActorLocalRotation`에 회전값을 전달합니다.\n\n이 호출의 엔진 내부 구현은 아직 확인하지 않았습니다.'],
];

export async function demoNotes(root, workspaceId) {
  const source = await readSource(root, DEMO_FILE);
  const createdAt = new Date().toISOString();
  return sections.map(([start, end, title, body], order) => ({ id: randomUUID(), groupId: randomUUID(), workspaceId, path: DEMO_FILE, start, end, title, body, order,
    summary: '컴포넌트 생성부터 프레임별 회전까지, 작은 액터의 실행 흐름을 살펴보는 직접 작성한 예제입니다.',
    hash: source.hash, snapshot: source.text.split('\n').slice(start - 1, end).join('\n'), createdAt, revision: 1, selected: true, origin: 'sample',
    evidence: [{ path: 'Source/ReaderDemo/Public/ReadingActor.h', start: 9, end: 29 }] }));
}
