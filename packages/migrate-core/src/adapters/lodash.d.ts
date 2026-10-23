/** lodash ships no types; Fern names its pages with this function, so the adapter calls the same one. */
declare module 'lodash/kebabCase.js' {
  export default function kebabCase(value?: string): string;
}
