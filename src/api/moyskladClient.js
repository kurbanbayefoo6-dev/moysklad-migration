import axios from 'axios'
import { config } from '../config/index.js'

const DEFAULT_TIMEOUT = 30000

function redactHeaders(headers = {}) {
	const redacted = { ...headers }
	if (redacted.Authorization) {
		redacted.Authorization = '[REDACTED]'
	}
	if (redacted.authorization) {
		redacted.authorization = '[REDACTED]'
	}
	return redacted
}

function getAxiosDiagnostics(error) {
	return {
		message: error.message,
		code: error.code,
		method: error.config?.method,
		url: error.config?.url,
		baseURL: error.config?.baseURL,
		params: error.config?.params,
		data: error.config?.data,
		headers: redactHeaders(error.config?.headers),
	}
}

function formatError(error) {
	if (error.response) {
		const status = error.response.status
		const method = error.config?.method?.toUpperCase() || 'REQUEST'
		const url = error.config?.url || 'unknown url'
		const message =
			error.response.data?.errors?.[0]?.error ||
			error.response.data?.error ||
			error.response.data?.message ||
			`MoySklad API returned status ${status}`

		const formattedError = new Error(`${method} ${url} failed: ${message}`)
		formattedError.responseBody = error.response.data
		formattedError.responseJson = error.response.data
		formattedError.status = status
		formattedError.url = url
		formattedError.axiosError = getAxiosDiagnostics(error)
		formattedError.cause = error
		return formattedError
	}

	if (error.request) {
		const formattedError = new Error('MoySklad API request failed: no response received')
		formattedError.axiosError = getAxiosDiagnostics(error)
		formattedError.cause = error
		return formattedError
	}

	const formattedError = new Error(error.message || 'MoySklad API request failed')
	formattedError.axiosError = getAxiosDiagnostics(error)
	formattedError.cause = error
	return formattedError
}

function createHttpClient(token) {
	if (!token) {
		throw new Error('Cannot create MoySklad client without an access token')
	}

	const client = axios.create({
		baseURL: config.moysklad.baseUrl,
		timeout: config.moysklad.timeout || DEFAULT_TIMEOUT,
		headers: {
			Accept: 'application/json;charset=utf-8',
			'Content-Type': 'application/json;charset=utf-8',
		},
	})

	client.interceptors.request.use(request => {
		request.headers = request.headers || {}
		request.headers.Authorization = `Bearer ${token}`
		return request
	})

	client.interceptors.response.use(
		response => response,
		error => Promise.reject(formatError(error)),
	)

	return client
}

export function createMoyskladClient(token) {
	const client = createHttpClient(token)

	return {
		async get(url, options = {}) {
			const response = await client.get(url, options)
			return response.data
		},
		async post(url, data, options = {}) {
			const response = await client.post(url, data, options)
			return response.data
		},
		async put(url, data, options = {}) {
			const response = await client.put(url, data, options)
			return response.data
		},
		async delete(url, options = {}) {
			const response = await client.delete(url, options)
			return response.data
		},
	}
}
