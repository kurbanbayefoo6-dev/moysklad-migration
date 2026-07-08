import { contractRepository } from '../repositories/contractRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class ContractResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Contract',
			repository: options.repository || contractRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}
}

export const contractResolver = new ContractResolver()

export default contractResolver
