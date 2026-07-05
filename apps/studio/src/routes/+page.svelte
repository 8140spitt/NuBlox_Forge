<script lang="ts">
  import { parseCsv, analyseCsv, generateAppSchemaFromImport } from '@nublox/import-engine';
  import { createRichClientManifest } from '@nublox/rich-client-engine';
  import { createRecordsFromCsv, summariseRecords, getRecordDisplayValue } from '@nublox/record-engine';

  const sampleCsv = `Project Name,Owner,Status,Due Date,Budget,Risk Level
Website Relaunch,Stephen,In Progress,2026-07-18,12500,Medium
CRM Cleanup,Amy,Blocked,2026-07-08,4000,High
Warehouse Audit,James,Not Started,2026-08-01,2500,Low
Supplier Review,Caitlin,Complete,2026-06-21,1800,Low`;

  let csvText = $state(sampleCsv);
  let appName = $state('Project Control');
  let selectedRecordId = $state<string | null>(null);
  let showJson = $state(false);

  let parsed = $derived(parseCsv(csvText));
  let analysis = $derived(analyseCsv(parsed));
  let appSchema = $derived(generateAppSchemaFromImport({ appName, importAnalysis: analysis }));
  let entity = $derived(appSchema.entities[0] ?? null);
  let manifest = $derived(createRichClientManifest(appSchema));
  let records = $derived(createRecordsFromCsv({ csv: parsed, appSchema }));
  let summary = $derived(summariseRecords(appSchema, records));
  let selectedRecord = $derived(records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null);

  $effect(() => {
    if (!selectedRecordId && records[0]) selectedRecordId = records[0].id;
    if (selectedRecordId && !records.some((record) => record.id === selectedRecordId)) {
      selectedRecordId = records[0]?.id ?? null;
    }
  });

  function resetSample() {
    csvText = sampleCsv;
    appName = 'Project Control';
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
      <div class="kicker">NuBlox Forge v0.2</div>
      <h1>Generated business workbench.</h1>
      <p class="lead">Paste a CSV and Forge generates an app schema, records, runtime commands, dashboard summary and a workbench-style record interface.</p>
    </section>

    <section class="grid">
      <div class="card">
        <div class="card-header"><p class="card-title">Input CSV</p></div>
        <div class="card-body">
          <label>App name <input bind:value={appName} class="text-input" /></label>
          <textarea bind:value={csvText} spellcheck="false"></textarea>
          <div class="actions">
            <button type="button" onclick={resetSample}>Load sample</button>
            <button type="button" class="secondary" onclick={() => showJson = !showJson}>{showJson ? 'Show workbench' : 'Show JSON'}</button>
          </div>
        </div>
      </div>

      <div class="preview">
        <div class="stat-grid">
          <div class="stat"><strong>{summary.totalRecords}</strong><span>records generated</span></div>
          <div class="stat"><strong>{analysis.columns.length}</strong><span>fields detected</span></div>
          <div class="stat"><strong>{summary.overdue?.count ?? 0}</strong><span>open overdue</span></div>
        </div>

        {#if showJson}
          <div class="card"><div class="card-body"><pre>{JSON.stringify({ appSchema, manifest }, null, 2)}</pre></div></div>
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
                {#each records as record}
                  <button type="button" class="record-button" class:selected={record.id === selectedRecord?.id} onclick={() => selectedRecordId = record.id}>
                    <strong>{record.title}</strong>
                  </button>
                {/each}
              </aside>

              <section class="record-detail">
                <div class="pane-title">Detail</div>
                {#if selectedRecord && entity}
                  <h2>{selectedRecord.title}</h2>
                  <div class="field-grid">
                    {#each entity.fields as field}
                      <div class="field-card"><span>{field.label}</span><strong>{getRecordDisplayValue(selectedRecord, field) || '—'}</strong></div>
                    {/each}
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
              </aside>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</main>
