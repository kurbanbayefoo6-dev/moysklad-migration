import { BaseRepository } from './baseRepository.js'

export class CounterpartyRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/counterparty',
			...options,
		})
	}
}

export const counterpartyRepository = new CounterpartyRepository()

export default counterpartyRepository
