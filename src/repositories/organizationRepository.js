import { BaseRepository } from './baseRepository.js'

export class OrganizationRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/organization',
			...options,
		})
	}
}

export const organizationRepository = new OrganizationRepository()

export default organizationRepository
