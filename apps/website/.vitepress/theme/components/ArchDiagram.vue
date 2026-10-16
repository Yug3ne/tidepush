<script setup lang="ts">
withDefaults(defineProps<{ caption?: string }>(), { caption: "" });
</script>

<template>
  <figure class="tp-arch">
    <svg viewBox="0 0 760 370" role="img" aria-labelledby="tp-arch-title tp-arch-desc">
      <title id="tp-arch-title">How Tidepush fits together</title>
      <desc id="tp-arch-desc">
        Your Expo app asks Tidepush for updates and gets a signed manifest. Tidepush keeps your release history
        and serves bundles from a global CDN. The CLI and the dashboard manage the same app.
      </desc>
      <defs>
        <marker id="tp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" class="tp-arrowhead" />
        </marker>
      </defs>

      <!-- clients -->
      <g>
        <rect x="16" y="40" width="200" height="86" rx="16" class="tp-box" />
        <text x="116" y="75" class="tp-t1">Your Expo app</text>
        <text x="116" y="99" class="tp-t2">stock expo-updates client</text>
      </g>
      <g>
        <rect x="16" y="196" width="200" height="66" rx="16" class="tp-box" />
        <text x="116" y="224" class="tp-t1">tidepush CLI</text>
        <text x="116" y="246" class="tp-t2">publish · promote · rollback</text>
      </g>
      <g>
        <rect x="16" y="284" width="200" height="66" rx="16" class="tp-box" />
        <text x="116" y="312" class="tp-t1">Dashboard</text>
        <text x="116" y="334" class="tp-t2">in your browser</text>
      </g>

      <!-- worker -->
      <g>
        <rect x="300" y="110" width="200" height="150" rx="20" class="tp-worker" />
        <text x="400" y="150" class="tp-tw1">Tidepush</text>
        <text x="400" y="172" class="tp-tw2">hosted for you</text>
        <text x="400" y="204" class="tp-tw3">update checks</text>
        <text x="400" y="224" class="tp-tw3">signing</text>
        <text x="400" y="244" class="tp-tw3">rollouts · rollbacks</text>
      </g>

      <!-- storage -->
      <g>
        <rect x="568" y="70" width="184" height="80" rx="16" class="tp-box tp-store" />
        <text x="660" y="103" class="tp-t1">Release history</text>
        <text x="660" y="126" class="tp-t2">updates, channels, devices</text>
      </g>
      <g>
        <rect x="568" y="220" width="184" height="80" rx="16" class="tp-box tp-store" />
        <text x="660" y="253" class="tp-t1">Global CDN</text>
        <text x="660" y="276" class="tp-t2">bundles and images</text>
      </g>

      <!-- arrows -->
      <path d="M216 66 L 298 126" class="tp-line" marker-end="url(#tp-arrow)" />
      <text x="226" y="50" class="tp-label" text-anchor="start">asks for updates</text>
      <path d="M298 172 L 218 114" class="tp-line tp-accent-line" marker-end="url(#tp-arrow)" />
      <text x="236" y="164" class="tp-label tp-label-accent" text-anchor="end">signed manifest</text>

      <path d="M216 229 L 298 222" class="tp-line" marker-end="url(#tp-arrow)" />
      <text x="258" y="212" class="tp-label" text-anchor="middle">API token</text>
      <path d="M216 317 C 260 317, 280 270, 330 262" class="tp-line" marker-end="url(#tp-arrow)" />
      <text x="262" y="330" class="tp-label" text-anchor="middle">login session</text>

      <path d="M500 160 L 566 120" class="tp-line" marker-end="url(#tp-arrow)" />
      <path d="M500 214 L 566 254" class="tp-line" marker-end="url(#tp-arrow)" />
    </svg>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.tp-arch {
  margin: 0;
}
svg {
  display: block;
  width: 100%;
  height: auto;
}
.tp-box {
  fill: var(--vp-c-bg);
  stroke: var(--tp-border);
  stroke-width: 1.5;
}
.tp-store {
  fill: var(--tp-input);
}
.tp-worker {
  fill: var(--tp-navy);
  stroke: var(--tp-accent);
  stroke-width: 2;
}
.tp-t1,
.tp-tw1 {
  font-family: var(--tp-font-heading);
  font-size: 17px;
  font-weight: 600;
  text-anchor: middle;
  fill: var(--vp-c-text-1);
}
.tp-t2 {
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  text-anchor: middle;
  fill: var(--vp-c-text-2);
}
.tp-tw1 {
  fill: #ffffff;
  font-size: 20px;
}
.tp-tw2 {
  font-size: 13px;
  text-anchor: middle;
  fill: #c3cec8;
}
.tp-tw3 {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  text-anchor: middle;
  fill: #18d26e;
}
.tp-line {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.6;
}
.tp-accent-line {
  stroke: var(--tp-accent-dark);
}
.tp-arrowhead {
  fill: var(--vp-c-text-3);
}
.tp-label {
  font-family: var(--vp-font-family-base);
  font-size: 12px;
  fill: var(--vp-c-text-2);
}
.tp-label-accent {
  fill: var(--tp-accent-dark);
  font-weight: 700;
}
.dark .tp-label-accent {
  fill: var(--tp-accent);
}
.dark .tp-accent-line {
  stroke: var(--tp-accent);
}
figcaption {
  margin-top: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-align: center;
}
</style>
