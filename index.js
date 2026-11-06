/**
 * Host half of the DSH UI Toolbox bundle (dsh-ui-toolbox).
 *
 * The toolbox is pure Web UI: the sidebar entry, the floating drawer, the
 * element picker and the composer hand-off all live in `client.js`, which
 * reads live app state through Client services. No Host service, tool, or
 * session data is needed, so this half owns no resources.
 */
export function apply() {}
