<script lang="ts">
  import { parseCsv, analyseCsv, generateAppSchemaFromImport } from '@nublox/import-engine';
  import { createRichClientManifest } from '@nublox/rich-client-engine';

  const sampleCsv = `Project Name,Owner,Status,Due Date,Budget,Risk Level
Website Relaunch,Stephen,In Progress,2026-07-18,12500,Medium
CRM Cleanup,Amy,Blocked,2026-07-08,4000,High
Warehouse Audit,James,Not Started,2026-08-01,2500,Low
Supplier Review,Caitlin,Complete,2026-06-21,1800,Low`;

  let csvText = $state(sampleCsv);
  let appName = $state('Project Control');

  let parsed = $derived(parseCsv(csvText));
  let analysis = $derived(analyseCsv(parsed));
  let appSchema = $derived(generateAppSchemaFromImport({
    appName,
    importAnalysis: analysis
  }));
  let manifest = $derived(createRichClientManifest(appSchema));

  function resetSample() {
    csvText = sampleCsv;
    appName = 'Project Control';
  }
</script>

<svelte:head>
  <title>NuBlox Forge Starter</title>
  <meta
    name="description"
    content="NuBlox Forge starter: turn CSV data into a generated business workbench manifest."
  />
</svelte:head>

<main class="page">
  <div class="shell">
    <section class="hero">
      <div class="kicker">NuBlox Forge v0.1</div>
      <h1>CSV to business workbench.</h1>
      <p class="lead">
        This is the first working spine: parse a CSV, detect fields, generate an app schema,
        then produce the rich client commands, menus, views and perspective manifest.
      </p>
    </section>

    <section class="grid">
      <div class="card">
        <div class="card-header">
          <p class="card-title">Input CSV</p>
        </div>
        <div class="card-body">
          <label>
            App name
            <input bind:value={appName} style="width: 100%; margin: 8px 0 14px; padding: 12px; border: 1px solid #d1d5db; border-radius: 12px;" />
          </label>

          <textarea bind:value={csvText} spellcheck="false" />

          <div class="actions">
            <button type="button" onclick={resetSample}>Load sample</button>
            <button type="button" class="secondary" onclick={() => navigator.clipboard?.writeText(JSON.stringify(appSchema, null, 2))}>
              Copy schema JSON
            </button>
          </div>
        </div>
      </div>

      <div class="preview">
        <div class="stat-grid">
          <div class="stat">
            <strong>{analysis.rowCount}</strong>
            <span>records detected</span>
          </div>
          <div class="stat">
            <strong>{analysis.columns.length}</strong>
            <span>fields detected</span>
          </div>
          <div class="stat">
            <strong>{manifest.commands.length}</strong>
            <span>commands generated</span>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <p class="card-title">Detected fields</p>
          </div>
          <div class="card-body table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Role</th>
                  <th>Completeness</th>
                </tr>
              </thead>
              <tbody>
                {#each analysis.columns as column}
                  <tr>
                    <td>{column.originalName}</td>
                    <td><span class="badge">{column.detectedType}</span></td>
                    <td>{column.semanticRole ?? 'field'}</td>
                    <td>{Math.round(column.completeness * 100)}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <p class="card-title">Generated rich client manifest</p>
          </div>
          <div class="card-body">
            <pre>{JSON.stringify(manifest, null, 2)}</pre>
          </div>
        </div>
      </div>
    </section>
  </div>
</main>
