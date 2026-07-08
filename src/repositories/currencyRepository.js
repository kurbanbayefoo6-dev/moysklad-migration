import { BaseRepository } from './baseRepository.js'

export class CurrencyRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/currency',
			...options,
		})
	}
}

export const currencyRepository = new CurrencyRepository()

export default currencyRepository
