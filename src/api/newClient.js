import { config } from '../config/index.js'
import { createMoyskladClient } from './moyskladClient.js'

export const newClient = createMoyskladClient(config.newToken)
