<script setup lang="ts">
import ArchDiagram from "./ArchDiagram.vue";

const repo = "https://github.com/Yug3ne/tidepush";

const features = [
  {
    title: "Stock expo-updates client",
    body: "Your app keeps the official expo-updates library. You only point updates.url at your own server.",
    icon: "M4 7h16M4 12h10M4 17h7",
  },
  {
    title: "Signed manifests",
    body: "Every manifest and rollback is signed with your private key. The app refuses anything unsigned or changed.",
    icon: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  },
  {
    title: "Staged rollouts",
    body: "Ship to 5% of devices, watch, then widen. Devices that already have the update keep it.",
    icon: "M4 19V5M4 19h16M8 15l3-4 3 2 5-6",
  },
  {
    title: "Instant rollback",
    body: "One command puts devices back on the previous update, or on the bundle built into the app.",
    icon: "M9 7H4V2M4.5 7A8 8 0 1 1 4 12",
  },
  {
    title: "Promote staging → production",
    body: "Test an update on staging builds, then promote the exact same files to production.",
    icon: "M5 12h14M13 6l6 6-6 6",
  },
  {
    title: "Adoption dashboard",
    body: "See which devices run which update and runtime, plus a full audit log of who did what.",
    icon: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  },
  {
    title: "Admin accounts & API tokens",
    body: "Email and password accounts with owner and admin roles. Scoped tokens for the CLI and CI.",
    icon: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0M12 7v0",
  },
  {
    title: "Runs on Cloudflare",
    body: "One Worker, one D1 database, one R2 bucket. Fits the free plan or the $5/month Workers plan.",
    icon: "M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18H7Z",
  },
];

const steps = [
  {
    n: "1",
    title: "You publish",
    body: "The CLI runs expo export, uploads only the files the server doesn't have yet, and records a new update.",
  },
  {
    n: "2",
    title: "The app checks",
    body: "On launch, expo-updates asks the Worker: “anything newer for my channel and runtime?”",
  },
  {
    n: "3",
    title: "The app updates",
    body: "It downloads the signed update in the background and runs it on the next launch.",
  },
];
</script>

<template>
  <div class="tp-landing">
    <!-- Hero -->
    <section class="tp-hero">
      <div class="tp-wrap tp-hero-grid">
        <div class="tp-hero-text">
          <p class="tp-eyebrow"><span class="tp-dot" /> Open source · AGPL-3.0</p>
          <h1>Tidepush</h1>
          <p class="tp-tagline">Self-hosted OTA updates for Expo apps, on Cloudflare.</p>
          <p class="tp-lead">
            Ship JavaScript fixes to your React Native app without waiting for a store review. Keep the updates, the
            keys and the data on your own Cloudflare account.
          </p>
          <div class="tp-actions">
            <a class="tp-btn tp-btn-primary" href="/guide/getting-started">Get started</a>
            <a class="tp-btn tp-btn-ghost" :href="repo" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
                />
              </svg>
              GitHub
            </a>
          </div>
        </div>

        <div class="tp-terminal" aria-label="Example: publishing an update with the CLI">
          <div class="tp-terminal-bar"><span /><span /><span /></div>
          <pre><code><span class="tp-prompt">$</span> bun run tidepush publish --channel production \
    -m "Fix fee copy on the send screen"
<span class="tp-dim">• Exporting ios + android bundle(s)…
• Reading app config and runtime version…
  ios      runtime 3f9c1a…  bundle 7.9 MB  42 assets
  android  runtime 3f9c1a…  bundle 8.1 MB  42 assets
• Uploading 2/86 files (16.0 MB)…</span>
<span class="tp-ok">✔ Published to production at 100% (group 7c1e0b52-…)</span>
<span class="tp-dim">  ios      9b0e6c1d-…
  android  4f2a8e77-…</span></code></pre>
        </div>
      </div>
    </section>

    <!-- What it is -->
    <section class="tp-section">
      <div class="tp-wrap tp-narrow">
        <h2>What it is</h2>
        <p class="tp-p">
          Tidepush is a small server that speaks the
          <a href="https://docs.expo.dev/technical-specs/expo-updates-1/" target="_blank" rel="noopener">Expo Updates protocol</a>.
          Your app keeps using the official <code>expo-updates</code> library; you point it at your own server instead of
          Expo's hosted service. Tidepush runs as a single Cloudflare Worker, stores update details in D1 and files in R2,
          and comes with a command-line tool to publish updates and a dashboard to watch and control them.
        </p>
      </div>
    </section>

    <!-- How it works -->
    <section class="tp-section tp-alt">
      <div class="tp-wrap">
        <h2>How it works</h2>
        <p class="tp-sub">Three pieces you run, one library you already use.</p>
        <div class="tp-how">
          <div class="tp-card tp-diagram"><ArchDiagram /></div>
          <ol class="tp-steps">
            <li v-for="s in steps" :key="s.n">
              <span class="tp-step-n">{{ s.n }}</span>
              <div>
                <h3>{{ s.title }}</h3>
                <p>{{ s.body }}</p>
              </div>
            </li>
          </ol>
        </div>
        <p class="tp-more"><a href="/guide/how-it-works">Read the full request flow →</a></p>
      </div>
    </section>

    <!-- Features -->
    <section class="tp-section">
      <div class="tp-wrap">
        <h2>Features</h2>
        <p class="tp-sub">Everything you need to ship and undo JavaScript updates safely.</p>
        <div class="tp-grid">
          <div v-for="f in features" :key="f.title" class="tp-card tp-feature">
            <span class="tp-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path :d="f.icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <h3>{{ f.title }}</h3>
            <p>{{ f.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Cost -->
    <section class="tp-section tp-alt">
      <div class="tp-wrap tp-cost">
        <div>
          <h2>What it costs</h2>
          <p class="tp-p">
            For most apps, roughly <strong>$0–5 a month</strong>. Workers and D1 fit the free plan or the $5/month Workers
            Paid plan. R2 charges about $0.015 per GB stored each month and has <strong>no egress fees</strong>, so it costs
            the same whether 100 or 100,000 phones download an update.
          </p>
          <p class="tp-p tp-small">
            Each publish stores only files that changed. A Hermes bundle is usually 5–10 MB per platform.
            <a href="/reference/costs">See costs and limits →</a>
          </p>
        </div>
        <div class="tp-card tp-price">
          <div class="tp-price-row"><span>Workers + D1</span><strong>$0 or $5</strong></div>
          <div class="tp-price-row"><span>R2 storage</span><strong>~$0.015 / GB</strong></div>
          <div class="tp-price-row"><span>Downloads (egress)</span><strong>$0</strong></div>
          <div class="tp-price-total"><span>Typical total</span><strong>$0–5 / month</strong></div>
        </div>
      </div>
    </section>

    <!-- Open source -->
    <section class="tp-section">
      <div class="tp-wrap tp-narrow tp-oss">
        <h2>Open source</h2>
        <p class="tp-p">
          Tidepush is licensed under the <strong>GNU AGPL-3.0</strong>. You can use it, self-host it and change it. If you
          run a modified version as a service for others, you share your changes under the same license. If that doesn't
          fit your company, commercial licenses are available.
        </p>
        <div class="tp-actions tp-center">
          <a class="tp-btn tp-btn-ghost" href="/license">License details</a>
          <a class="tp-btn tp-btn-ghost" :href="repo" target="_blank" rel="noopener">Source on GitHub</a>
        </div>
      </div>
    </section>

    <section class="tp-section tp-cta">
      <div class="tp-wrap tp-narrow">
        <h2>Ship your first update in an afternoon</h2>
        <p class="tp-p">One linear tutorial takes you from an empty Cloudflare account to an update running on a phone.</p>
        <div class="tp-actions tp-center">
          <a class="tp-btn tp-btn-primary" href="/guide/getting-started">Start the tutorial</a>
          <a class="tp-btn tp-btn-on-navy" href="/guide/what-is-tidepush">Read the introduction</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tp-landing {
  background: var(--tp-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
}
.tp-wrap {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}
.tp-narrow {
  max-width: 760px;
  text-align: center;
}
.tp-section {
  padding: 72px 0;
  border-top: 1px solid var(--tp-divider);
}
.tp-alt {
  background: var(--vp-c-bg);
}
h1,
h2,
h3 {
  font-family: var(--tp-font-heading);
  color: var(--vp-c-text-1);
  letter-spacing: -0.02em;
}
h2 {
  font-size: 32px;
  line-height: 1.2;
  font-weight: 700;
  margin: 0 0 12px;
}
h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 6px;
}
.tp-sub {
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
  font-size: 17px;
}
.tp-p {
  color: var(--vp-c-text-2);
  font-size: 17px;
  line-height: 1.7;
  margin: 0 0 16px;
}
.tp-p a,
.tp-more a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.tp-p code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
  background: var(--tp-input);
  padding: 2px 6px;
  border-radius: 6px;
}
.tp-small {
  font-size: 15px;
}

/* Hero */
.tp-hero {
  padding: 80px 0 72px;
}
.tp-hero-grid {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 48px;
  align-items: center;
}
.tp-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--tp-accent-tint);
  color: var(--vp-c-brand-1);
  font-family: var(--tp-font-heading);
  font-size: 13px;
  font-weight: 600;
}
.tp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tp-accent);
}
.tp-hero h1 {
  font-size: 64px;
  line-height: 1;
  font-weight: 700;
  margin: 0 0 16px;
}
.tp-tagline {
  font-family: var(--tp-font-heading);
  font-size: 26px;
  line-height: 1.3;
  font-weight: 500;
  color: var(--vp-c-text-1);
  margin: 0 0 16px;
}
.tp-lead {
  font-size: 18px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  margin: 0 0 28px;
  max-width: 520px;
}
.tp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.tp-center {
  justify-content: center;
  margin-top: 8px;
}
.tp-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  border-radius: var(--tp-radius-btn);
  font-family: var(--tp-font-heading);
  font-weight: 600;
  font-size: 16px;
  text-decoration: none;
  border: 1.5px solid transparent;
  transition: background-color 0.15s, border-color 0.15s;
}
.tp-btn-primary {
  background: var(--tp-accent);
  color: var(--tp-on-accent);
}
.tp-btn-primary:hover {
  background: var(--tp-accent-dark);
}
.tp-btn-ghost {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-color: var(--tp-border);
}
.tp-btn-ghost:hover {
  border-color: var(--vp-c-text-3);
}
.tp-btn-on-navy {
  color: #ffffff;
  border-color: #ffffff40;
}
.tp-btn-on-navy:hover {
  border-color: #ffffff;
}

.tp-terminal {
  background: #10263e;
  border-radius: var(--tp-radius-card);
  overflow: hidden;
  border: 1px solid #1a3a5c;
}
.dark .tp-terminal {
  background: #15201c;
  border-color: #22302a;
}
.tp-terminal-bar {
  display: flex;
  gap: 6px;
  padding: 14px 16px 0;
}
.tp-terminal-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ffffff26;
}
.tp-terminal pre {
  margin: 0;
  padding: 16px 20px 22px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #ffffff;
}
.tp-prompt {
  color: #18d26e;
}
.tp-dim {
  color: #c3cec8;
  opacity: 0.8;
}
.tp-ok {
  color: #18d26e;
  font-weight: 600;
}

/* Cards */
.tp-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-radius-card);
}
.tp-alt .tp-card {
  background: var(--tp-bg);
}

/* How */
.tp-how {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 32px;
  align-items: center;
}
.tp-diagram {
  padding: 20px;
}
.tp-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 24px;
}
.tp-steps li {
  display: flex;
  gap: 16px;
}
.tp-steps p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
.tp-step-n {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--tp-accent-tint);
  color: var(--vp-c-brand-1);
  font-family: var(--tp-font-heading);
  font-weight: 700;
}
.tp-more {
  margin: 28px 0 0;
}

/* Features */
.tp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.tp-feature {
  padding: 24px;
}
.tp-feature p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.6;
}
.tp-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: var(--tp-accent-tint);
  color: var(--vp-c-brand-1);
}

/* Cost */
.tp-cost {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 48px;
  align-items: center;
}
.tp-price {
  padding: 8px 24px;
}
.tp-price-row,
.tp-price-total {
  display: flex;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--tp-divider);
  color: var(--vp-c-text-2);
}
.tp-price strong {
  font-family: var(--tp-font-heading);
  color: var(--vp-c-text-1);
}
.tp-price-total {
  border-bottom: 0;
}
.tp-price-total span {
  color: var(--vp-c-text-1);
  font-weight: 700;
}
.tp-price-total strong {
  color: var(--vp-c-brand-1);
  font-size: 18px;
}

/* CTA */
.tp-cta {
  background: #10263e;
  border-top: 0;
}
.dark .tp-cta {
  background: #15201c;
  border-top: 1px solid var(--tp-divider);
}
.tp-cta h2 {
  color: #ffffff;
}
.tp-cta .tp-p {
  color: #c3cec8;
}

@media (max-width: 960px) {
  .tp-hero-grid,
  .tp-how,
  .tp-cost {
    grid-template-columns: 1fr;
  }
  .tp-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 560px) {
  .tp-hero {
    padding-top: 48px;
  }
  .tp-hero h1 {
    font-size: 48px;
  }
  .tp-tagline {
    font-size: 21px;
  }
  .tp-grid {
    grid-template-columns: 1fr;
  }
  h2 {
    font-size: 26px;
  }
}
</style>
