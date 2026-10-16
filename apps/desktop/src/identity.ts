import { IdentityError, uuidV7 } from '@financial-manager/contracts';
import { DomainError, utcInstant } from '@financial-manager/domain';
// The product host binds these narrow operations to Rust. No SQL/key/clock IPC.
export function createDesktopIdentity(
  bridge: Readonly<{
    newId: () => Promise<unknown>;
    nowInstant: () => Promise<unknown>;
  }>,
) {
  const newId = bridge.newId,
    nowInstant = bridge.nowInstant;
  return Object.freeze({
    async newId() {
      try {
        return uuidV7(await newId());
      } catch (error) {
        throw error instanceof IdentityError
          ? error
          : new IdentityError('ENTROPY_UNAVAILABLE');
      }
    },
    async nowInstant() {
      try {
        return utcInstant(await nowInstant());
      } catch (error) {
        throw error instanceof DomainError
          ? error
          : new IdentityError('CLOCK_UNAVAILABLE');
      }
    },
  });
}
