
package smartport_m1m.service;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import smartport_m1m.m1.dto.CreateVesselRequest;
import smartport_m1m.m1.dto.UpdateVesselRequest;
@Service
public class ShipApiService {

    private final RestClient restClient;

    public ShipApiService(
            @Value("${smartport.node-api.base-url}") String baseUrl) {

        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    // Lay danh sach tau tu Node.js
    public Map<String, Object> getAllShips() {

        return restClient.get()
                .uri("/api/ships")
                .retrieve()
                .body(new ParameterizedTypeReference<
                        Map<String, Object>>() {});
    }

    // Gui ho so tau moi sang Node.js de luu SQL Server
    public Map<String, Object> createShip(
            CreateVesselRequest request) {

        Map<String, Object> data = Map.of(
                "ship_code", request.shipCode(),
                "ship_name", request.shipName(),
                "ship_type", request.shipType(),
                "capacity", request.capacity(),
                "imo_number", request.imoNumber(),
                "length_overall", request.lengthOverall(),
                "draft", request.draft(),
                "status", "AT_SEA"
        );

        return restClient.post()
                .uri("/api/ships")
                .contentType(MediaType.APPLICATION_JSON)
                .body(data)
                .retrieve()
                .body(new ParameterizedTypeReference<
                        Map<String, Object>>() {});
    }
    
    // UC-011: Lay chi tiet tau tu Node.js
    public Map<String, Object> getShipById(long id) {

        return restClient.get()
                .uri("/api/ships/{id}", id)
                .retrieve()
                .body(new ParameterizedTypeReference<
                        Map<String, Object>>() {});
    }

    // UC-011: Tim kiem tau qua Node.js
    public Map<String, Object> searchShips(String keyword) {

        return restClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/ships/search")
                        .queryParam("q", keyword)
                        .build())
                .retrieve()
                .body(new ParameterizedTypeReference<
                        Map<String, Object>>() {});
    }

// UC-011: Gui yeu cau cap nhat tau sang Node.js
public Map<String, Object> updateShip(
        long id,
        UpdateVesselRequest request) {

    Map<String, Object> data = Map.of(
        "ship_code", request.shipCode().trim(),
        "ship_name", request.shipName().trim(),
        "ship_type", request.shipType().trim(),
        "imo_number", request.imoNumber(),
        "capacity", request.capacity(),
        "length_overall", request.lengthOverall(),
        "draft", request.draft()
    );

    return restClient.put()
            .uri("/api/ships/{id}", id)
            .contentType(MediaType.APPLICATION_JSON)
            .body(data)
            .retrieve()
            .body(new ParameterizedTypeReference<
                    Map<String, Object>>() {});
}

// UC-011: Goi API Node.js de ngung su dung tau
public Map<String, Object> deactivateShip(
        long id, String reason) {

    return restClient.patch()
            .uri("/api/ships/{id}/deactivate", id)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("reason", reason))
            .retrieve()
            .body(new ParameterizedTypeReference<
                    Map<String, Object>>() {});
}

}

