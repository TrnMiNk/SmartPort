
package smartport_m1m.m1.service;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.client.HttpClientErrorException;
import smartport_m1m.m1.dto.CreateVesselRequest;
import smartport_m1m.service.ShipApiService;
import smartport_m1m.m1.dto.UpdateVesselRequest;
@Service
public class VesselService {

    private final ShipApiService shipApiService;

    public VesselService(ShipApiService shipApiService) {
        this.shipApiService = shipApiService;
    }

    // Kiem tra ma tau trung qua Node.js API
    public void validateShipCode(String shipCode) {

        Map<String, Object> response;

        try {
            response = shipApiService.getAllShips();
        } catch (RestClientException ex) {
            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Khong ket noi duoc API danh sach tau",
                ex
            );
        }

        if (response == null ||
            !Boolean.TRUE.equals(response.get("success")) ||
            !(response.get("data") instanceof List<?> ships)) {

            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Du lieu tu Node.js khong hop le"
            );
        }

        for (Object item : ships) {

            if (!(item instanceof Map<?, ?> ship)) {
                continue;
            }

            Object code = ship.get("ship_code");

            if (code instanceof String existingCode &&
                existingCode.equalsIgnoreCase(shipCode.trim())) {

                throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Ma tau da ton tai: " + shipCode
                );
            }
        }
    }

    // UC-010: Tao ho so tau
    public Map<String, Object> createVessel(
            CreateVesselRequest request) {

        // 1. Kiem tra ma tau da ton tai chua
        validateShipCode(request.shipCode());

        // 2. Goi Node.js API de luu vao SQL Server
        try {

            Map<String, Object> result =
                    shipApiService.createShip(request);

            if (result == null ||
                !Boolean.TRUE.equals(result.get("success")) ||
                result.get("id") == null) {

                throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Node.js khong tra ve ket qua tao tau hop le"
                );
            }

            return result;

        } catch (RestClientResponseException ex) {

            int status = ex.getStatusCode().value();

            // Trung ma tau hoac IMO
            if (status == 409) {
                throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Ma tau hoac IMO da ton tai",
                    ex
                );
            }

            // Du lieu bi Node.js tu choi
            if (status == 400) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Du lieu tau khong hop le",
                    ex
                );
            }

            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Node.js API tra ve loi",
                ex
            );

        } catch (RestClientException ex) {

            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Khong the ket noi Node.js API",
                ex
            );
        }
    }
    
    // UC-011: Tra cuu ho so tau theo ID
    public Map<String, Object> getVesselById(long id) {

        if (id <= 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "ID tau khong hop le"
            );
        }

        try {
            Map<String, Object> result =
                    shipApiService.getShipById(id);

            if (result == null ||
                !Boolean.TRUE.equals(result.get("success")) ||
                !(result.get("data") instanceof Map<?, ?>)) {

                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Du lieu tau khong hop le"
                );
            }

            return result;

        } catch (HttpClientErrorException.NotFound ex) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Khong tim thay tau",
                    ex
            );

        } catch (RestClientException ex) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Loi khi goi Node.js API",
                    ex
            );
        }
    }

    // UC-011: Tim kiem ho so tau
    public Map<String, Object> searchVessels(String keyword) {

        if (keyword == null ||
            keyword.trim().isEmpty() ||
            keyword.trim().length() > 100) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Tu khoa phai co tu 1 den 100 ky tu"
            );
        }

        try {
            Map<String, Object> result =
                    shipApiService.searchShips(keyword.trim());

            if (result == null ||
                !Boolean.TRUE.equals(result.get("success")) ||
                !(result.get("data") instanceof List<?>)) {

                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Ket qua tim kiem khong hop le"
                );
            }

            return result;

        } catch (RestClientException ex) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Khong the tim kiem tu Node.js API",
                    ex
            );
        }
    }

// UC-011: Cap nhat ho so tau
public Map<String, Object> updateVessel(
        long id,
        UpdateVesselRequest request) {

    if (id <= 0) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "ID tau khong hop le"
        );
    }

    try {
        Map<String, Object> result =
                shipApiService.updateShip(id, request);

        if (result == null ||
            !Boolean.TRUE.equals(result.get("success")) ||
            !(result.get("data") instanceof Map<?, ?>)) {

            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Ket qua cap nhat tu Node.js khong hop le"
            );
        }

        return result;

    } catch (RestClientResponseException ex) {

        int status = ex.getStatusCode().value();

        if (status == 404) {
            throw new ResponseStatusException(
                HttpStatus.NOT_FOUND,
                "Khong tim thay tau",
                ex
            );
        }

        if (status == 409) {
            throw new ResponseStatusException(
                HttpStatus.CONFLICT,
                "Ma tau hoac IMO da ton tai",
                ex
            );
        }

        if (status == 400) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Du lieu cap nhat khong hop le",
                ex
            );
        }

        throw new ResponseStatusException(
            HttpStatus.BAD_GATEWAY,
            "Node.js API cap nhat that bai",
            ex
        );

    } catch (RestClientException ex) {

        throw new ResponseStatusException(
            HttpStatus.BAD_GATEWAY,
            "Khong the ket noi Node.js API",
            ex
        );
    }
}

// UC-011: Nghiep vu ngung su dung tau
public Map<String, Object> deactivateVessel(
        long id, String reason) {

    if (id <= 0) {
        throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "ID tau khong hop le"
        );
    }

    if (reason == null || reason.isBlank()
            || reason.length() > 500) {
        throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Ly do ngung su dung khong hop le"
        );
    }

    try {
        Map<String, Object> result =
                shipApiService.deactivateShip(id, reason.trim());

        if (result == null ||
                !Boolean.TRUE.equals(result.get("success"))) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Phan hoi Node.js khong hop le"
            );
        }

        return result;

    } catch (RestClientResponseException ex) {
        int status = ex.getStatusCode().value();

        if (status == 400 || status == 404 || status == 409) {
            throw new ResponseStatusException(
                    HttpStatus.valueOf(status),
                    "Khong the ngung su dung tau",
                    ex
            );
        }

        throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Node.js API gap loi",
                ex
        );

    } catch (RestClientException ex) {
        throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Khong ket noi duoc Node.js API",
                ex
        );
    }
}

}
