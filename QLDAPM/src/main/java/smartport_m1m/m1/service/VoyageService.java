package smartport_m1m.m1.service;

import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;
import smartport_m1m.service.VoyageApiClient;
import tools.jackson.databind.ObjectMapper;

@Service
public class VoyageService {
    private final VoyageApiClient client;
    public VoyageService(VoyageApiClient client) { this.client = client; }

    public Map<String, Object> create(CreateArrivalNoticeRequest request, String key) {
        if (key == null || key.isBlank() || key.length() > 200)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Idempotency-Key header is required (max 200 characters)");
        try {
            OffsetDateTime.parse(request.declaredEta());
        } catch (RuntimeException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "declaredEta must be ISO 8601 with a timezone");
        }
        return invoke(() -> client.create(request, key));
    }

    public Map<String, Object> get(long id) {
        if (id <= 0 || id > Integer.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id must be a positive integer");
        return invoke(() -> client.get(id));
    }

    public Map<String, Object> validate(long id, String operatorKey) {
        requireOperatorKey(operatorKey);
        if (id <= 0 || id > Integer.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id must be a positive integer");
        return invokeValidation(() -> client.validate(id, operatorKey));
    }

    public Map<String, Object> queue(String operatorKey) {
        requireOperatorKey(operatorKey);
        return invokeValidation(() -> client.queue(operatorKey));
    }

    private void requireOperatorKey(String key) {
        if (key == null || key.isBlank() || key.length() > 512)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "X-UC015-Key is required");
    }

    private Map<String, Object> invokeValidation(java.util.function.Supplier<Map<String, Object>> call) {
        try {
            Map<String, Object> result = call.get();
            if (result == null) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid response from Node.js");
            return result;
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400 || status == 401 || status == 403 || status == 404 || status == 409 || status == 422 || status == 503)
                throw new VoyageHttpException(status, parseErrorBody(exception));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js validation service is unavailable", exception);
        } catch (RestClientException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js validation service is unavailable", exception);
        }
    }

    private Map<String, Object> invoke(java.util.function.Supplier<Map<String, Object>> call) {
        try {
            Map<String, Object> result = call.get();
            if (result == null) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid response from Node.js");
            return result;
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400 || status == 404 || status == 409 || status == 422)
                throw new VoyageHttpException(status, parseErrorBody(exception));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js voyage service is unavailable", exception);
        } catch (RestClientException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js voyage service is unavailable", exception);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseErrorBody(RestClientResponseException exception) {
        try {
            Map<String, Object> result = new ObjectMapper().readValue(exception.getResponseBodyAsByteArray(), Map.class);
            if (result != null) return result;
            return Map.of("success", false, "message", "Node.js rejected the voyage request");
        } catch (Exception ignored) {
            return Map.of("success", false, "message", "Node.js rejected the voyage request");
        }
    }
}
