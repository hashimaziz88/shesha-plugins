import type { ThemeConfig } from 'antd';

/**
 * Shesha theme for Ant Design v6.3.5
 *
 * Deliberately minimal. Three seed tokens are overridden; everything else is an
 * Ant Design default and is derived automatically by Ant's own algorithm.
 *
 * Do not add tokens here to "fix" a component. If a component looks wrong, the
 * component is being used wrongly. Adding overrides here breaks the guarantee
 * that Shesha stays aligned with Ant Design and makes future upgrades painful.
 *
 * Verified against antd@6.3.5 by executing theme.getDesignToken().
 */
export const sheshaTheme: ThemeConfig = {
  token: {
    // Shesha Cobalt. Replaces Ant's #1677ff.
    // Measures 9.26:1 against white in both directions (AAA).
    // Cascades to every interactive element in all 72 components.
    colorPrimary: '#003BB2',

    // Informational messaging follows the brand rather than Ant's blue.
    colorInfo: '#003BB2',

    // Shesha Nero. Replaces Ant's pure black text seed.
    // Produces rgba(24,24,24,0.88) primary text at 12.45:1 (AAA).
    colorTextBase: '#181818',

    // Font stack. Ant's default is prepended with Inter.
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, " +
      "'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', " +
      "'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
  },
};

/**
 * Optional accessibility hardening.
 *
 * Five Ant Design defaults fail WCAG 2.2 AA. Ant ships them deliberately and
 * they are not Shesha's choice, but a Shesha application in a regulated or
 * public-sector deployment may be required to meet AA.
 *
 * Applying this makes those five pass. It also moves Shesha further from stock
 * Ant Design, so it is opt-in per deployment rather than the default.
 *
 * Measured values are recorded against #FFFFFF.
 */
export const sheshaThemeAccessible: ThemeConfig = {
  token: {
    ...sheshaTheme.token,

    // Ant default rgba(24,24,24,0.25) = 1.73:1. Fails.
    colorTextQuaternary: 'rgba(24,24,24,0.55)', // 4.53:1

    // Ant default #d9d9d9 = 1.41:1. Control boundaries need 3:1.
    colorBorder: '#8C8C8C', // 3.36:1

    // Ant default #52c41a = 2.27:1. Fails as text and as fill.
    colorSuccess: '#12793C', // 5.49:1

    // Ant default #faad14 = 1.90:1. Amber cannot carry white text at any
    // usable saturation, so warning fills take dark text.
    colorWarning: '#C77F09', // 3.25:1 as fill, 5.08:1 with #1F1F1F text

    // Ant default #ff4d4f = 3.27:1. Fails as text.
    colorError: '#C3232B', // 5.84:1
  },
};

export default sheshaTheme;
