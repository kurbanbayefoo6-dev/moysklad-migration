import { BaseRepository } from './baseRepository.js'

export class ContractRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/contract',
			...options,
		})
	}
}

export const contractRepository = new ContractRepository()

export default contractRepository
