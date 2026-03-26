# visual-qa

A hypercritical screenshot reviewer powered by Claude vision API. Finds defects instead of confirming correctness.

## Install

```bash
npm install -g visual-qa
# or run without installing:
npx visual-qa screenshot.png
```

## Usage

### Review a single screenshot

```bash
visual-qa screenshot.png
```

### Add context about what the screenshot should show

```bash
visual-qa screenshot.png --expect "login form with email and password fields and a submit button"
```

### Compare before/after for regressions

```bash
visual-qa --before before.png --after after.png
```

### Compare with context

```bash
visual-qa --before before.png --after after.png --expect "dark mode redesign of the dashboard"
```

### Output parseable JSON

```bash
visual-qa screenshot.png --json
visual-qa --before before.png --after after.png --json
```

## JSON Output Format

### Single review

```json
{
  "verdict": "PASS" | "FAIL" | "WARN",
  "score": 85,
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "Layout",
      "description": "Navigation items overflow container on 1280px viewport",
      "suggestion": "Add overflow: hidden and ellipsis or collapse to hamburger at breakpoint"
    }
  ],
  "summary": "The design is largely solid but has a critical layout overflow issue..."
}
```

### Comparison

```json
{
  "verdict": "REGRESSION" | "IMPROVEMENT" | "UNCHANGED" | "MIXED",
  "regressions": [
    {
      "severity": "major",
      "category": "Typography",
      "description": "Body font size reduced from 16px to 12px, hurting readability",
      "suggestion": "Revert body font-size to 16px minimum"
    }
  ],
  "improvements": [
    "Button contrast ratio improved — now meets WCAG AA",
    "Consistent 8px grid spacing applied throughout"
  ],
  "summary": "The after screenshot introduced a font size regression..."
}
```

## Exit Codes

- `0` — PASS / IMPROVEMENT / UNCHANGED
- `1` — FAIL / REGRESSION / error

## Environment Variables

Requires `ANTHROPIC_API_KEY` to be set.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## CLAUDE.md Integration

Add this snippet to your project's `CLAUDE.md` to enable automatic visual QA during development:

```markdown
## Visual QA

Before marking any UI task as done, run a visual check:

```bash
# Review a screenshot of your changes
npx visual-qa screenshot.png --expect "brief description of what this page should show"

# If you have before/after screenshots, check for regressions
npx visual-qa --before before.png --after after.png

# For CI integration (exits 1 on fail/regression)
npx visual-qa screenshot.png --json | jq '.verdict'
```

- Take screenshots with your browser's screenshot tool or Puppeteer
- The tool uses a hypercritical prompt — fix FAIL and WARN issues before shipping
- CRITICAL severity issues must be fixed; MAJOR issues should be fixed
- Attach `--json` output to your completion summary when submitting UI work
```

## Development

```bash
npm install
npm run build
node dist/index.js screenshot.png
```

## License

MIT
