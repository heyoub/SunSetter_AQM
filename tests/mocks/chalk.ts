/**
 * Chalk Mock for Jest
 *
 * Mocks chalk to avoid ESM import issues in Jest.
 * This provides a no-op implementation that passes through strings.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createChainableChalk = (): any => {
  const handler: ProxyHandler<() => string> = {
    get(target, prop) {
      if (prop === 'visible') return createChainableChalk();
      if (typeof prop === 'string' && prop.startsWith('bg')) {
        return createChainableChalk();
      }
      return createChainableChalk();
    },
    apply(_target, _thisArg, args) {
      return args.join(' ');
    },
  };

  return new Proxy(((str: string) => str) as () => string, handler);
};

const chalk = createChainableChalk();

export default chalk;
export { chalk };
