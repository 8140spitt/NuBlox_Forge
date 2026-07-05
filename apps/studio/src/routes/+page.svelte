<script lang="ts">
  import { parseCsv, analyseCsv, generateAppSchemaFromImport } from '@nublox/import-engine';
  import { createRichClientManifest } from '@nublox/rich-client-engine';
  import {
    createRecordsFromCsv,
    summariseRecords,
    type GeneratedRecord,
    type RecordValue
  } from '@nublox/record-engine';
  import { createUpdateAuditEvent, formatAuditValue, type AuditEvent } from '@nublox/audit-engine';
  import {
    createPersistenceSnapshot,
    generateMysqlBootstrapScript,
    type PersistenceSnapshot
  } from '@nublox/persistence-engine';
  import type { FieldSchema } from '@nublox/schema-engine';

  const localStorageKey = 'nublox-forge:v0.4:snapshot';

  const sampleCsv = `Project Name,Owner,Status,Due Date,Budget,Risk Level
Website Relaunch,Stephen,In Progress,2026-07-18,12500,Medium
CRM Cleanup,Amy,Blocked,2026-07-08,4000,High
Warehouse Audit,James,Not Started,2026-08-01,2500,Low
Supplier Review,Caitlin,Complete,2026-06-21,1800,Low`;

  let csvText = $state(sampleCsv);
  let appName = $state('Project Control');
  let selectedRecordId = $state<string | null>(null);
  let activePanel = $state<'workbench' | 'json' | 'sql'>('workbench');
  let sourceSignature = $state('');
  let editableRecords = $state<GeneratedRecord[]>([]);
  let editRecordId = $state<string | null>(null);
  let editBuffer = $state<Record<string, string>>({});
  let auditEvents = $state<AuditEvent[]>([]);
  let persistenceMessage = $state('Not saved locally yet.');

  let parsed = $derived(parseCsv(csvText));
  let analysis = $derived(analyseCsv(parsed));
  let appSchema = $derived(generateAppSchemaFromImport({ appName, importAnalysis: analysis }));
  let entity = $derived(appSchema.entities[0] ?? null);
  let manifest = $derived(createRichClientManifest(appSchema));
  let sourceRecords = $derived(createRecordsFromCsv({ csv: parsed, appSchema }));
  let summary = $derived(summariseRecords(appSchema, editableRecords));
  let selectedRecord = $derived(editableRecords.find((record) => record.id === selectedRecordId) ?? editableRecords[0] ?? null);
  let snapshot = $derived(createPersistenceSnapshot({ app: appSchema, records: editableRecords, auditEvents }));
  let mysqlSql = $derived(generateMysqlBootstrapScript(snapshot));

  $effect(() => {
    const nextSignature = JSON.stringify(sourceRecords.map((record) => ({ id: record.id, title: record.title, data: record.data })));

    if (nextSignature !== sourceSignature) {
      sourceSignature = nextSignature;
      editableRecords = sourceRecords;
      auditEvents = [];
      selectedRecordId = sourceRecords[0]?.id ?? null;
      persistenceMessage = 'CSV changed. Local runtime state reset.';
    }
  });

  $effect(() => {
    if (selectedRecord && selectedRecord.id !== editRecordId) {
      editRecordId = selectedRecord.id;
      editBuffer = recordToEditBuffer(selectedRecord);
    }
  });

  function resetSample() {
    csvText = sampleCsv;
    appName = 'Project Control';
    activePanel = 'workbench';
  }

  function updateEditBuffer(fieldName: string, value: string) {
    editBuffer = {
      ...editBuffer,
      [fieldName]: value
    };
  }

  function saveSelectedRecord() {
    if (!selectedRecord || !entity) return;

    const data: Record<string, RecordValue> = { ...selectedRecord.data };

    for (const field of entity.fields) {
      data[field.name] = coerceEditableValue(editBuffer[field.name] ?? '', field);
    }

    const titleField = findTitleField(entity.fields);
    const title = titleField ? stringifyRecordValue(data[titleField.name]) || selectedRecord.title : selectedRecord.title;

    const updatedRecord: GeneratedRecord = {
      ...selectedRecord,
      title,
      data,
      updatedAt: new Date().toISOString()
    };

    const labelsByFieldName = Object.fromEntries(entity.fields.map((field) => [field.name, field.label]));
    const auditEvent = createUpdateAuditEvent({
      before: selectedRecord,
      after: updatedRecord,
      labelsByFieldName,
      actor: 'Local user'
    });

    editableRecords = editableRecords.map((record) => record.id === updatedRecord.id ? updatedRecord : record);
    editBuffer = recordToEditBuffer(updatedRecord);

    if (auditEvent) {
      auditEvents = [auditEvent, ...auditEvents];
      persistenceMessage = 'Record saved in memory. Local/MySQL export snapshot has changed.';
    } else {
      persistenceMessage = 'No field changes detected.';
    }
  }

  function saveSnapshotLocally() {
    localStorage.setItem(localStorageKey, JSON.stringify(snapshot));
    persistenceMessage = `Saved locally at ${new Date().toLocaleTimeString()}.`;
  }

  function loadSnapshotLocally() {
    const raw = localStorage.getItem(localStorageKey);

    if (!raw) {
      persistenceMessage = 'No local snapshot found.';
      return;
    }

    const parsedSnapshot = JSON.parse(raw) as PersistenceSnapshot;

    if (parsedSnapshot.version !== 1) {
      persistenceMessage = 'Local snapshot version is not supported.';
      return;
    }

    editableRecords = parsedSnapshot.records;
    auditEvents = parsedSnapshot.auditEvents;
    selectedRecordId = parsedSnapshot.records[0]?.id ?? null;
    editRecordId = null;
    persistenceMessage = `Loaded local snapshot from ${new Date(parsedSnapshot.capturedAt).toLocaleString()}.`;
  }

  function copyMysqlSql() {
    navigator.clipboard?.writeText(mysqlSql);
    persistenceMessage = 'Copied MySQL bootstrap SQL to clipboard.';
  }

  function recordToEditBuffer(record: GeneratedRecord): Record<string, string> {
    return Object.fromEntries(
      Object.entries(record.data).map(([fieldName, value]) => [fieldName, stringifyRecordValue(value)])
    );
  }

  function coerceEditableValue(rawValue: string, field: FieldSchema): RecordValue {
    const value = rawValue.trim();

    if (value.length === 0) return null;

    if (field.type === 'number' || field.type === 'currency') {
      const number = Number(value.replace(/[£$,\s]/g, ''));
      return Number.isNaN(number) ? null : number;
    }

    if (field.type === 'boolean') {
      if (/^(true|yes|y|1)$/i.test(value)) return true;
      if (/^(false|no|n|0)$/i.test(value)) return false;
      return null;
    }

    return value;
  }

  function stringifyRecordValue(value: RecordValue | undefined): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  function findTitleField(fields: FieldSchema[]): FieldSchema | undefined {
    return fields.find((field) => field.semanticRole === 'title') ?? fields.find((field) => field.type === 'text') ?? fields[0];
  }

  function money(value: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0
    }).format(value);
  }
</script>

<svelte:head>
  <title>NuBlox Forge Starter</title>
</svelte:head>

<main class="page">
  <div class="shell">
    <section class="hero">
      <div class="kicker">NuBlox Forge v0.4</div>
      <h1>Persistent generated workbench.</h1>
      <p class="lead">Generate records, edit them, capture audit events, save/load a local runtime snapshot and export a MySQL bootstrap script.</p>
    </section>

    <section class="grid">
      <div class="card">
        <div class="card-header"><p class="card-title">Input CSV</p></div>
        <div class="card-body">
          <label>App name <input bind:value={appName} class="text-input" /></label>
          <textarea bind:value={csvText} spellcheck="false"></textarea>
          <div class="actions">
            <button type="button" onclick={resetSample}>Load sample</button>
            <button type="button" class="secondary" onclick={() => activePanel = 'workbench'}>Workbench</button>
            <button type="button" class="secondary" onclick={() => activePanel = 'json'}>JSON</button>
            <button type="button" class="secondary" onclick={() => activePanel = 'sql'}>MySQL SQL</button>
            <button type="button" class="secondary" onclick={saveSnapshotLocally}>Save local</button>
            <button type="button" class="secondary" onclick={loadSnapshotLocally}>Load local</button>
          </div>
          <p class="lead">{persistenceMessage}</p>
        </div>
      </div>

      <div class="preview">
        <div class="stat-grid">
          <div class="stat"><strong>{summary.totalRecords}</strong><span>records</span></div>
          <div class="stat"><strong>{auditEvents.length}</strong><span>audit events</span></div>
          <div class="stat"><strong>5</strong><span>MySQL tables</span></div>
        </div>

        {#if activePanel === 'json'}
          <div class="card"><div class="card-body"><pre>{JSON.stringify({ appSchema, manifest, snapshot }, null, 2)}</pre></div></div>
        {:else if activePanel === 'sql'}
          <div class="card">
            <div class="card-header"><p class="card-title">Generated MySQL bootstrap SQL</p></div>
            <div class="card-body">
              <div class="actions"><button type="button" onclick={copyMysqlSql}>Copy SQL</button></div>
              <pre>{mysqlSql}</pre>
            </div>
          </div>
        {:else}
          <div class="workbench card">
            <div class="workbench-topbar">
              <div><strong>{appSchema.name}</strong><span>{entity?.pluralLabel ?? 'Records'}</span></div>
              <div class="command-row">
                {#each manifest.commands.slice(0, 3) as command}
                  <button type="button" class="mini-command">{command.label}</button>
                {/each}
              </div>
            </div>

            <div class="workbench-grid">
              <aside class="record-list">
                <div class="pane-title">Records</div>
                {#each editableRecords as record}
                  <button type="button" class="record-button" class:selected={record.id === selectedRecord?.id} onclick={() => selectedRecordId = record.id}>
                    <strong>{record.title}</strong>
                  </button>
                {/each}
              </aside>

              <section class="record-detail">
                <div class="pane-title">Editable detail</div>
                {#if selectedRecord && entity}
                  <h2>{selectedRecord.title}</h2>
                  <div class="field-grid">
                    {#each entity.fields as field}
                      <label class="field-card">
                        <span>{field.label}</span>
                        <input
                          class="text-input"
                          value={editBuffer[field.name] ?? ''}
                          oninput={(event) => updateEditBuffer(field.name, (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                    {/each}
                  </div>
                  <div class="actions">
                    <button type="button" onclick={saveSelectedRecord}>Save record</button>
                  </div>
                {/if}
              </section>

              <aside class="dashboard-pane">
                <div class="pane-title">Dashboard</div>
                {#if summary.status}
                  <div class="dashboard-block"><strong>Status</strong>{#each summary.status.values as item}<div class="bar-row"><span>{item.label}</span><b>{item.count}</b></div>{/each}</div>
                {/if}
                {#if summary.money && summary.money.length > 0}
                  <div class="dashboard-block"><strong>Money</strong>{#each summary.money as item}<div class="bar-row"><span>{item.label}</span><b>{money(item.total)}</b></div>{/each}</div>
                {/if}
                <div class="dashboard-block"><strong>Audit trail</strong>
                  {#if auditEvents.length === 0}
                    <div class="bar-row"><span>No changes saved yet</span><b>0</b></div>
                  {:else}
                    {#each auditEvents as event}
                      <div class="bar-row"><span>{event.recordTitle}</span><b>{event.changes.length}</b></div>
                      {#each event.changes as change}
                        <div class="bar-row"><span>{change.label}: {formatAuditValue(change.before)} → {formatAuditValue(change.after)}</span><b>edit</b></div>
                      {/each}
                    {/each}
                  {/if}
                </div>
              </aside>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</main>
