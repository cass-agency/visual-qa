#!/usr/bin/env node

import { Command } from 'commander';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const MODEL = 'claude-3-5-sonnet-20241022';

interface QAResult {
  verdict: 'PASS' | 'FAIL' | 'WARN';
  score: number; // 0-100, 100 = perfect
  issues: Issue[];
  summary: string;
}

interface Issue {
  severity: 'critical' | 'major' | 'minor';
  category: string;
  description: string;
  suggestion?: string;
}

interface CompareResult {
  verdict: 'REGRESSION' | 'IMPROVEMENT' | 'UNCHANGED' | 'MIXED';
  regressions: Issue[];
  improvements: string[];
  summary: string;
}

function loadImageAsBase64(imagePath: string): { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' } {
  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Image file not found: ${resolvedPath}`);
  }

  const ext = path.extname(imagePath).toLowerCase();
  const mediaTypeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  const mediaType = mediaTypeMap[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image format: ${ext}. Supported: jpg, jpeg, png, gif, webp`);
  }

  const data = fs.readFileSync(resolvedPath).toString('base64');
  return { data, mediaType };
}

function buildSingleReviewPrompt(expectation?: string): string {
  const contextClause = expectation
    ? `\n\nCONTEXT FROM SUBMITTER: "${expectation}"\n\nEven with this context, apply the same hypercritical standards — the context helps you understand intent, not excuse defects.`
    : '';

  return `You are a HYPERCRITICAL visual QA engineer. Your job is to find defects, not confirm correctness. You are reviewing a UI screenshot for production quality.${contextClause}

YOUR MANDATE: Be brutally honest. Every pixel counts. Users notice imperfections even when they can't name them. Ship nothing that isn't excellent.

EVALUATE FOR:
1. **Layout & Alignment** — Are elements misaligned? Inconsistent spacing? Off-grid items? Orphaned text?
2. **Typography** — Wrong font sizes, weights, or line heights? Text overflow or clipping? Poor readability?
3. **Color & Contrast** — WCAG contrast violations? Inconsistent use of brand colors? Visual noise?
4. **Spacing & Rhythm** — Inconsistent padding/margins? Elements too close or too far? Breathing room issues?
5. **Visual Hierarchy** — Is the primary action obvious? Are secondary elements properly subordinated?
6. **Responsiveness indicators** — Signs of overflow, horizontal scroll, or broken layout?
7. **Component integrity** — Buttons, inputs, cards — do they look complete and polished?
8. **Empty/loading states** — If visible, are they intentional and well-designed?
9. **Accessibility signals** — Focus indicators, alt text implied by context, sufficient target sizes?
10. **Polish level** — Does this look production-ready or like a dev build?

SCORING RUBRIC:
- 90-100: Production-ready, minor nitpicks only
- 75-89: Shippable with small fixes
- 60-74: Needs significant work before shipping
- 40-59: Major issues, do not ship
- 0-39: Fundamentally broken

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no preamble):
{
  "verdict": "PASS" | "FAIL" | "WARN",
  "score": <0-100>,
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "<Layout|Typography|Color|Spacing|Hierarchy|Responsiveness|Components|Accessibility|Polish>",
      "description": "<specific, actionable description of the defect>",
      "suggestion": "<concrete fix suggestion>"
    }
  ],
  "summary": "<2-3 sentence honest summary of overall quality>"
}

VERDICT RULES:
- PASS: score >= 80 AND no critical issues
- WARN: score >= 60 AND no critical issues (or score >= 80 with critical issues)
- FAIL: score < 60 OR any critical issue

Do not soften feedback. If something is broken, say it is broken.`;
}

function buildComparePrompt(expectation?: string): string {
  const contextClause = expectation
    ? `\n\nCONTEXT: "${expectation}"\n`
    : '';

  return `You are a HYPERCRITICAL visual regression analyst. You are comparing a BEFORE screenshot (first image) and an AFTER screenshot (second image) to detect regressions, improvements, and changes.${contextClause}

YOUR MANDATE: Find every visual regression. An improvement that introduces a regression elsewhere is still a regression. Be exhaustive.

EVALUATE CHANGES IN:
1. Layout shifts — Did anything move unexpectedly?
2. Typography changes — Font, size, weight, color, spacing
3. Color changes — Background, foreground, borders, shadows
4. Spacing changes — Padding, margin, gap alterations
5. Missing elements — Things that existed before that are now gone
6. New elements — New additions (could be improvement or clutter)
7. Broken states — Things that worked before that look broken now
8. Size changes — Unexpected resizing of components
9. Alignment regressions — Things that were aligned now aren't
10. Polish regressions — Anything that looked better before

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no preamble):
{
  "verdict": "REGRESSION" | "IMPROVEMENT" | "UNCHANGED" | "MIXED",
  "regressions": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "<Layout|Typography|Color|Spacing|Hierarchy|Components|Accessibility|Polish>",
      "description": "<what regressed and how>",
      "suggestion": "<how to fix it>"
    }
  ],
  "improvements": ["<description of improvement>"],
  "summary": "<2-3 sentence honest summary of the diff>"
}

VERDICT RULES:
- REGRESSION: any regressions exist (regardless of improvements)
- IMPROVEMENT: improvements exist, zero regressions
- MIXED: regressions AND improvements exist (use REGRESSION if any critical ones)
- UNCHANGED: no meaningful visual differences`;
}

function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return '  (none)';
  return issues.map(issue => {
    const sev = issue.severity.toUpperCase().padEnd(8);
    const lines = [`  [${sev}] ${issue.category}: ${issue.description}`];
    if (issue.suggestion) {
      lines.push(`           → ${issue.suggestion}`);
    }
    return lines.join('\n');
  }).join('\n');
}

function printSingleResult(result: QAResult, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const verdictColor = result.verdict === 'PASS' ? '\x1b[32m' : result.verdict === 'WARN' ? '\x1b[33m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('');
  console.log(`${verdictColor}▶ VERDICT: ${result.verdict}${reset}  (score: ${result.score}/100)`);
  console.log('');
  console.log('SUMMARY:');
  console.log(`  ${result.summary}`);
  console.log('');

  const criticals = result.issues.filter(i => i.severity === 'critical');
  const majors = result.issues.filter(i => i.severity === 'major');
  const minors = result.issues.filter(i => i.severity === 'minor');

  if (criticals.length > 0) {
    console.log(`\x1b[31mCRITICAL ISSUES (${criticals.length}):\x1b[0m`);
    console.log(formatIssues(criticals));
    console.log('');
  }

  if (majors.length > 0) {
    console.log(`\x1b[33mMAJOR ISSUES (${majors.length}):\x1b[0m`);
    console.log(formatIssues(majors));
    console.log('');
  }

  if (minors.length > 0) {
    console.log(`MINOR ISSUES (${minors.length}):`);
    console.log(formatIssues(minors));
    console.log('');
  }

  if (result.issues.length === 0) {
    console.log('\x1b[32mNo issues found.\x1b[0m');
    console.log('');
  }
}

function printCompareResult(result: CompareResult, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const verdictColor =
    result.verdict === 'IMPROVEMENT' ? '\x1b[32m' :
    result.verdict === 'UNCHANGED' ? '\x1b[36m' :
    '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('');
  console.log(`${verdictColor}▶ VERDICT: ${result.verdict}${reset}`);
  console.log('');
  console.log('SUMMARY:');
  console.log(`  ${result.summary}`);
  console.log('');

  if (result.regressions.length > 0) {
    console.log(`\x1b[31mREGRESSIONS (${result.regressions.length}):\x1b[0m`);
    console.log(formatIssues(result.regressions));
    console.log('');
  }

  if (result.improvements.length > 0) {
    console.log(`\x1b[32mIMPROVEMENTS (${result.improvements.length}):\x1b[0m`);
    result.improvements.forEach(imp => console.log(`  + ${imp}`));
    console.log('');
  }

  if (result.regressions.length === 0 && result.improvements.length === 0) {
    console.log('\x1b[36mNo meaningful visual differences detected.\x1b[0m');
    console.log('');
  }
}

function parseJsonResponse<T>(text: string): T {
  // Strip any markdown code blocks if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse Claude response as JSON.\nRaw response:\n${text}`);
  }
}

async function reviewSingle(imagePath: string, expectation: string | undefined, jsonOutput: boolean): Promise<void> {
  const client = new Anthropic();
  const image = loadImageAsBase64(imagePath);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.data,
            },
          },
          {
            type: 'text',
            text: buildSingleReviewPrompt(expectation),
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const result = parseJsonResponse<QAResult>(text);
  printSingleResult(result, jsonOutput);

  // Exit with non-zero code on failure so CI can catch it
  if (!jsonOutput && result.verdict === 'FAIL') {
    process.exit(1);
  }
}

async function reviewCompare(beforePath: string, afterPath: string, expectation: string | undefined, jsonOutput: boolean): Promise<void> {
  const client = new Anthropic();
  const beforeImage = loadImageAsBase64(beforePath);
  const afterImage = loadImageAsBase64(afterPath);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'BEFORE screenshot:',
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: beforeImage.mediaType,
              data: beforeImage.data,
            },
          },
          {
            type: 'text',
            text: 'AFTER screenshot:',
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: afterImage.mediaType,
              data: afterImage.data,
            },
          },
          {
            type: 'text',
            text: buildComparePrompt(expectation),
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const result = parseJsonResponse<CompareResult>(text);
  printCompareResult(result, jsonOutput);

  if (!jsonOutput && result.verdict === 'REGRESSION') {
    process.exit(1);
  }
}

const program = new Command();

program
  .name('visual-qa')
  .description('Hypercritical screenshot reviewer powered by Claude vision API')
  .version('1.0.0');

program
  .argument('[screenshot]', 'Path to screenshot image to review')
  .option('--before <path>', 'Before screenshot for regression comparison')
  .option('--after <path>', 'After screenshot for regression comparison')
  .option('--expect <description>', 'Add context about what the screenshot should show')
  .option('--json', 'Output parseable JSON instead of human-readable text')
  .action(async (screenshot: string | undefined, options: { before?: string; after?: string; expect?: string; json?: boolean }) => {
    const jsonOutput = !!options.json;

    try {
      if (options.before && options.after) {
        // Regression comparison mode
        await reviewCompare(options.before, options.after, options.expect, jsonOutput);
      } else if (screenshot) {
        // Single review mode
        await reviewSingle(screenshot, options.expect, jsonOutput);
      } else {
        console.error('Error: provide a screenshot path or use --before and --after flags');
        console.error('');
        console.error('Examples:');
        console.error('  visual-qa screenshot.png');
        console.error('  visual-qa screenshot.png --expect "login form with email and password fields"');
        console.error('  visual-qa --before before.png --after after.png');
        console.error('  visual-qa screenshot.png --json');
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof Error) {
        if (!jsonOutput) {
          console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        } else {
          console.error(JSON.stringify({ error: err.message }));
        }
      }
      process.exit(1);
    }
  });

program.parse();
