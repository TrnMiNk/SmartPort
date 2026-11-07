package smartport_m1m.service;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class VesselDocumentApiClient {

    private final RestClient restClient;

    @Autowired
    public VesselDocumentApiClient(
            @Value("${smartport.node-api.base-url}") String baseUrl) {
        this(baseUrl, RestClient.builder());
    }

    VesselDocumentApiClient(String baseUrl, RestClient.Builder builder) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public Map<String, Object> upload(
            long shipId, String documentType, Resource file, String filename,
            MediaType fileContentType) {
        MultiValueMap<String, Object> parts = new org.springframework.util.LinkedMultiValueMap<>();
        parts.add("document_type", documentType);
        HttpHeaders fileHeaders = new HttpHeaders();
        fileHeaders.setContentType(fileContentType);
        fileHeaders.setContentDisposition(ContentDisposition.formData()
                .name("file").filename(filename).build());
        org.springframework.http.HttpEntity<Resource> filePart =
                new org.springframework.http.HttpEntity<>(file, fileHeaders);
        parts.add("file", filePart);

        return restClient.post()
                .uri("/api/ships/{id}/documents", shipId)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(parts)
                .retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    public Map<String, Object> list(long shipId) {
        return restClient.get()
                .uri("/api/ships/{id}/documents", shipId)
                .retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    public Map<String, Object> metadata(long shipId, long documentId) {
        return restClient.get()
                .uri("/api/ships/{shipId}/documents/{documentId}", shipId, documentId)
                .retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    public ResponseEntity<byte[]> download(long shipId, long documentId) {
        return restClient.get()
                .uri("/api/ships/{shipId}/documents/{documentId}/download", shipId, documentId)
                .retrieve()
                .toEntity(byte[].class);
    }

    public Map<String, Object> review(
            long shipId, long documentId, String status, String reviewNote) {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("status", status);
        body.put("review_note", reviewNote);
        return restClient.patch()
                .uri("/api/ships/{shipId}/documents/{documentId}/review", shipId, documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
