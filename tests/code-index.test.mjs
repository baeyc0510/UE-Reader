import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractSymbols } from '../server/source/code-index/cpp-symbols.mjs';
import { createCodeIndexes } from '../server/source/code-index/service.mjs';

test('C++ symbols: types, in-class declarations, out-of-class definitions, delegates; no calls or init lists', () => {
  const symbols = extractSymbols([
    'DECLARE_DELEGATE_RetVal(bool, FOnCheck);',
    'class ENGINE_API AMyActor : public AActor', '{', '  GENERATED_BODY()', 'public:', '  virtual void Tick(float Delta) override;', '};',
    'void AMyActor::Tick(float Delta)', '{', '  Super::Tick(Delta);', '}',
    'AMyActor::AMyActor()', '  : Super()', '{', '}',
  ].join('\n')).map(s => `${s.kind}:${s.scope ? s.scope + '::' : ''}${s.name}`);
  assert.deepEqual(symbols, ['delegate:FOnCheck', 'class:AMyActor', 'declaration:AMyActor::Tick', 'function:AMyActor::Tick', 'function:AMyActor::AMyActor']);
});

test('code index narrows search candidates, finds definitions and reuses the saved index when nothing changed', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-index-')), root = path.join(base, 'src');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'A.h'), 'class AThing\n{\n  void Run();\n};\n');
  await fs.writeFile(path.join(root, 'A.cpp'), 'void AThing::Run()\n{\n  CollectGarbageNow();\n}\n');
  await fs.writeFile(path.join(root, 'B.cpp'), 'int Other() { return 1; }\n');
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const ready = async index => { for (let i = 0; i < 200 && !(index.status().status === 'ready' && index.status().files); i++) await new Promise(r => setTimeout(r, 25)); return index.status(); };
  const first = createCodeIndexes({ dataDir: base }), index = first.get({ id: 'w', root });
  assert.equal((await ready(index)).parsed, 3);
  assert.deepEqual(await index.candidates('garbagenow'), ['A.cpp']);
  assert.equal(await index.candidates('->'), null);
  const [definition] = await index.symbols({ q: 'Run', exact: true, kind: 'definition', scope: 'AThing' });
  assert.equal(definition.path, 'A.cpp'); assert.equal(definition.line, 1);
  assert.equal((await index.symbols({ q: 'Run', exact: true, kind: 'declaration' }))[0].path, 'A.h');
  await first.close();
  const second = createCodeIndexes({ dataDir: base }), again = second.get({ id: 'w', root });
  const status = await ready(again);
  assert.equal(status.parsed, 0); assert.equal(status.files, 3);
  await second.close();
});

test('variables: members, namespace globals, static member definitions, enumerators with namespace scopes; locals by enclosing function', async () => {
  const { findLocalDeclaration } = await import('../server/source/code-index/cpp-symbols.mjs');
  const text = [
    'namespace UE::GC', '{', '  int32 GWorkerCount = 4;', '  class FCollector', '  {', '    UPROPERTY(EditAnywhere) float Speed = 1.f;', '    TObjectPtr<UObject> Target;',
    '    enum class EPhase : uint8 { Mark, Sweep };', '    void Run(int32 Count);', '  };', '}',
    'int32 UFoo::Instances = 0;',
    'void UE::GC::FCollector::Run(int32 Count)', '{', '  const FVector Offset(1, 2, 3);', '  for (auto& Item : Items)', '  {', '    Speed += Count + Offset.X;', '  }', '}',
  ].join('\n');
  const found = extractSymbols(text).filter(s => s.kind === 'variable' || s.kind === 'enumerator').map(s => `${s.kind}:${s.scope}::${s.name}`);
  assert.deepEqual(found, ['variable:UE::GC::GWorkerCount', 'variable:UE::GC::FCollector::Speed', 'variable:UE::GC::FCollector::Target', 'enumerator:UE::GC::FCollector::EPhase::Mark', 'enumerator:UE::GC::FCollector::EPhase::Sweep', 'variable:UFoo::Instances']);
  assert.equal(findLocalDeclaration(text, 18, 'Count').line, 13);
  assert.equal(findLocalDeclaration(text, 18, 'Offset').line, 15);
  assert.equal(findLocalDeclaration(text, 18, 'Item').line, 16);
  assert.equal(findLocalDeclaration(text, 18, 'Speed'), null);
});

test('symbol ranking prefers the members of the class around the click', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ue-reader-scope-')), root = path.join(base, 'src');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'A.h'), 'class UAlpha\n{\n  int32 Count;\n};\n');
  await fs.writeFile(path.join(root, 'B.h'), 'class UBeta\n{\n  int32 Count;\n};\n');
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const indexes = createCodeIndexes({ dataDir: base }), index = indexes.get({ id: 'w', root });
  for (let i = 0; i < 200 && !index.status().files; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal((await index.symbols({ q: 'Count', exact: true, kind: 'definition', context: 'UBeta' }))[0].path, 'B.h');
  assert.equal((await index.symbols({ q: 'Count', exact: true, kind: 'definition', context: 'UAlpha' }))[0].path, 'A.h');
  await indexes.close();
});
