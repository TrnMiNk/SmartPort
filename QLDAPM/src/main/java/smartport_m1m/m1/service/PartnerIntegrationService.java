package smartport_m1m.m1.service;

import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import smartport_m1m.m1.dto.PartnerArrivalNoticeRequest;
import smartport_m1m.service.PartnerIntegrationApiClient;

@Service
public class PartnerIntegrationService {
    private final PartnerIntegrationApiClient client;
    public PartnerIntegrationService(PartnerIntegrationApiClient client) { this.client = client; }

    public Map<String,Object> create(PartnerArrivalNoticeRequest request, String apiKey, String idem) {
        if (apiKey == null || apiKey.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "X-API-Key is required");
        if (apiKey.length() > 512) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid API key");
        if (idem == null || idem.isBlank() || idem.length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Idempotency-Key header is required (max 200 characters)");
        try { Instant.parse(request.declaredEta()); } catch (RuntimeException ex) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "declaredEta must be ISO 8601 UTC ending in Z"); }
        try {
            Map<String,Object> result = client.create(request, apiKey, idem);
            if (result == null) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid Node.js integration response");
            return result;
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (status == 400 || status == 401 || status == 403 || status == 404 || status == 409 || status == 422)
                throw new VoyageHttpException(status, parseBody(ex));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js integration service unavailable");
        } catch (RestClientException ex) { throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node.js integration service unavailable"); }
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> parseBody(RestClientResponseException ex) {
        try { return new tools.jackson.databind.ObjectMapper().readValue(ex.getResponseBodyAsByteArray(), Map.class); }
        catch (Exception ignored) { return Map.of("success", false, "message", "Integration request rejected"); }
    }
}
