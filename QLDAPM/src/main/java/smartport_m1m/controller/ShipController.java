
package smartport_m1m.controller;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import smartport_m1m.service.ShipApiService;

@RestController
@RequestMapping("/api/v1/ships")
public class ShipController {

    private final ShipApiService shipApiService;

    public ShipController(ShipApiService shipApiService) {
        this.shipApiService = shipApiService;
    }

    @GetMapping
    public Map<String, Object> getAllShips() {
        return shipApiService.getAllShips();
    }
}
