package smartport_m1m.service;

import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;

@Service
public class VoyageApiClient {
    private final RestClient restClient;

    @Autowired
    public VoyageApiClient(@Value("${smartport.node-api.base-url}") String baseUrl) {
        this(baseUrl, RestClient.builder());
    }

    VoyageApiClient(String baseUrl, RestClient.Builder builder) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public Map<String, Object> create(CreateArrivalNoticeRequest request, String key) {
        return restClient.post().uri("/api/voyages").header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).body(request).retrieve()
                .body(new ParameterizedTypeReference<>() {});
    }

    public Map<String, Object> get(long id) {
        return restClient.get().uri("/api/voyages/{id}", id).retrieve()
                .body(new ParameterizedTypeReference<>() {});
    }

    public Map<String, Object> validate(long id, String operatorKey) {
        return restClient.post().uri("/api/voyages/{id}/validate", id).header("X-UC015-Key", operatorKey)
                .retrieve().body(new ParameterizedTypeReference<>() {});
    }

    public Map<String, Object> queue(String operatorKey) {
        return restClient.get().uri("/api/voyages/queue").header("X-UC015-Key", operatorKey)
                .retrieve().body(new ParameterizedTypeReference<>() {});
    }

    public Map<String, Object> predictEta(long id, String operatorKey) {
        return restClient.post().uri("/api/voyages/{id}/eta-prediction", id).header("X-UC015-Key", operatorKey)
                .retrieve().body(new ParameterizedTypeReference<>() {});
    }

    public Map<String, Object> etaHistory(long id, String operatorKey, Long beforeId) {
        return restClient.get().uri(builder -> {
            var uri = builder.path("/api/voyages/{id}/eta-predictions");
            if (beforeId != null) uri.queryParam("beforeId", beforeId);
            return uri.build(id);
        }).header("X-UC015-Key", operatorKey).retrieve().body(new ParameterizedTypeReference<>() {});
    }
}
