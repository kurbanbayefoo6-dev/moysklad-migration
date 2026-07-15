import { BaseRepository } from './baseRepository.js'

const PAYMENT_IN_EXPAND = [
	'operations',
	'organization',
	'organizationAccount',
	'agent',
	'agentAccount',
	'contract',
	'project',
	'state',
	'rate.currency',
].join(',')

export class PaymentInRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/paymentin',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: PAYMENT_IN_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const paymentInRepository = new PaymentInRepository()

export default paymentInRepository
