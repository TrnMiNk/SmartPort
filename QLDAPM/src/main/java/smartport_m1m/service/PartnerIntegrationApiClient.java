package smartport_m1m.service;

import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import smartport_m1m.m1.dto.PartnerArrivalNoticeRequest;

@Service
public class PartnerIntegrationApiClient {
    private final RestClient client;
    @Autowired public PartnerIntegrationApiClient(@Value("${smartport.node-api.base-url}") String baseUrl) { client = RestClient.builder().baseUrl(baseUrl).build(); }
    public Map<String,Object> create(PartnerArrivalNoticeRequest request, String apiKey, String idem) {
        return client.post().uri("/api/v1/integration/voyages").header("X-API-Key", apiKey).header("Idempotency-Key", idem)
                .contentType(MediaType.APPLICATION_JSON).body(request).retrieve().body(new ParameterizedTypeReference<>() {});
    }
}
