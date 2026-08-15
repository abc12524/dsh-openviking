import { clientBundle } from './tsdown.client.ts'

/** Build the host lib and the browser client bundle for the OpenViking plugin. */
export default clientBundle('@deepseek-ai/dsh-openviking', ['lib/types/index.js'])
