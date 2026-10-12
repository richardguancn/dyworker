export const name = 'ds-bot';
export const inject = ['botTeam', 'connection'];

export function apply(ctx) {
  const team = ctx.botTeam.mount(new URL('./upstream/index.js', import.meta.url).href);
  ctx.effect(() => () => team.dispose());
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bot', methods: ['POST'],
    fetch: request => team.dispatch(request),
  }));
}
