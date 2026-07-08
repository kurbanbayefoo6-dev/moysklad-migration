import dotenv from 'dotenv'

dotenv.config()

function requireValue(name, value) {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}

	return value
}

export const config = {
	oldToken: requireValue('OLD_TOKEN', process.env.OLD_TOKEN),
	newToken: requireValue('NEW_TOKEN', process.env.NEW_TOKEN),
	moysklad: {
		baseUrl: 'https://api.moysklad.ru/api/remap/1.2/',
		timeout: 30000,
	},
}

export default config
