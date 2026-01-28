import { z } from '@zod/zod';


export const EntitySchema = z.object({
	name: z.string().describe('The name or text of the extracted entity, in lowercase and singular form.'),
	type: z.string().describe('The type or category of the extracted entity.')
});

export const EntitiesSchema = z.object({
	entities: z.array(EntitySchema).describe('A list of extracted entities with their names and types.')
});

export type Entity = z.infer<typeof EntitySchema>;
export type Entities = z.infer<typeof EntitiesSchema>;
