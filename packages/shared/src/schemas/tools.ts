import { z } from 'zod';

export const updateToolSettingSchema = z.object({
  enabled: z.boolean(),
});
