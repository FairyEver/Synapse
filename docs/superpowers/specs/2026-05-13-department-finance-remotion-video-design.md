# Department Finance Remotion Video Design

## Goal

Create a vertical Remotion video from Synapse `money_record` data that summarizes the department's current income and expense position. The video should be suitable for short-form viewing, with smooth chart motion and concise copy.

## Data Source

- Source table: `money_record`
- Row count at design time: 86
- Fields used: `type`, `amount`, `person`, `reason`
- The table has no date field, so the video presents a current snapshot instead of a time trend.

Current totals:

| Type | Amount |
| --- | ---: |
| 收入 | 5,540.00 |
| 支出 | 5,120.13 |
| 应收款 | 50.00 |
| 应付款 | 6,422.42 |

Computed balance:

```text
(收入 + 应收款) - (支出 + 应付款) = -5,952.55
```

Largest items to support the narrative:

| Type | Label | Amount |
| --- | --- | ---: |
| 应付款 | 苹东家宴 樊总垫付 | 2,753.00 |
| 支出 | 8月10号 瑞福春 | 1,432.00 |
| 应付款 | 樊总支付麦当劳 | 1,046.40 |
| 支出 | 王磊奖金 | 1,000.00 |

## Video Format

- Resolution: 1080 x 1920
- Frame rate: 60 fps
- Duration target: 15 seconds
- Orientation: vertical
- Style: restrained financial short video, no decorative gradients or noisy copy
- Language: Chinese

## Storyboard

1. `0-2s`: Show the balance `-5,952.55` as a fast count-up/count-down impact number. Title: `部门收支速览`.
2. `2-5s`: Focus on payable amount `6,422.42` with a dominant bar animation.
3. `5-9s`: Complete the four-category bar chart for `收入`, `支出`, `应收款`, and `应付款`.
4. `9-13s`: Transition to an animated pie chart showing category share.
5. `13-15s`: Conclude with `应付款占比最高，需优先处理。`

## Implementation Approach

Create a small Remotion project under a generated video workspace instead of modifying Synapse app runtime code. The project will include:

- A static JSON data file generated from the Synapse database query results.
- One Remotion composition named `DepartmentFinanceShort`.
- React components for the impact number, animated bar chart, animated pie chart, and final summary.
- Chart animation driven only by Remotion frame state.

Animation rules:

- Use `useCurrentFrame()` and `useVideoConfig()` for all timing.
- Use `spring()` for bar growth and number emphasis.
- Use `interpolate()` with explicit frame windows for opacity, position, and pie arc reveal.
- Do not use CSS transitions, CSS animations, or Tailwind animation utilities because they are not deterministic in Remotion renders.

## Verification

- Run TypeScript/build checks available in the Remotion project.
- Render at least one still frame from the composition to verify layout.
- Render the final MP4 if local Remotion dependencies and codecs are available.
- If full render is blocked by local environment issues, leave the project ready and report the exact command and blocker.

## Out of Scope

- No trend chart because the source table has no date column.
- No voiceover unless requested separately.
- No changes to the Synapse Electron app UI or runtime code.
