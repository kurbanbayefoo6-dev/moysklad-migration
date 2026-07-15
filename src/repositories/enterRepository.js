import { BaseRepository } from './baseRepository.js'

const ENTER_EXPAND = [
	'organization',
	'store',
	'positions.assortment',
	'state',
	'project',
	'owner',
	'group',
].join(',')

export class EnterRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/enter',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: ENTER_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const enterRepository = new EnterRepository()

export default enterRepository
