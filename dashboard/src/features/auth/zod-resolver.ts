import { zodResolver as baseZodResolver } from '@hookform/resolvers/zod'
import { type FieldValues, type Resolver } from 'react-hook-form'
import { type z } from 'zod'

export function zodResolver<TSchema extends z.ZodType>(
  schema: TSchema
): Resolver<z.input<TSchema> & FieldValues, unknown, z.output<TSchema>> {
  // pnpm can resolve the resolver's Zod peer to a different instance.
  return baseZodResolver(schema as never) as Resolver<
    z.input<TSchema> & FieldValues,
    unknown,
    z.output<TSchema>
  >
}
